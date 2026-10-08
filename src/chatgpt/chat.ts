import type { ChatOptions, Message, ToolCall } from '../ai-chat';
import { getChatGPTClient } from './client';
import { ChatGPTHttpError } from './http';
import { i18n } from '../utils/i18n';

const TOOL_NAMESPACE = 'siyuan_copilot';

function textContent(message: Message): string {
    return typeof message.content === 'string' ? message.content
        : message.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n');
}

/** Sidebar merges tool rounds into one assistant message; replay each round with its results. */
export function buildResponsesInput(messages: Message[]): { instructions: string; input: any[] } {
    const instructions = messages.filter(message => message.role === 'system').map(textContent).join('\n\n');
    const results = new Map(messages.filter(message => message.role === 'tool' && message.tool_call_id)
        .map(message => [message.tool_call_id!, message]));
    const consumed = new Set<string>();
    const input: any[] = [];
    const appendResults = (items: any[]) => {
        for (const item of items) {
            if (item.type !== 'function_call') continue;
            const result = results.get(item.call_id);
            if (!result) throw new Error(i18n('chatgptToolResultMissing'));
            input.push({ type: 'function_call_output', call_id: item.call_id, output: textContent(result) });
            consumed.add(item.call_id);
        }
    };
    for (const message of messages) {
        if (message.role === 'system') continue;
        if (message.role === 'tool') {
            if (consumed.has(message.tool_call_id!)) continue;
            input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: textContent(message) });
        } else if (message.role === 'assistant' && message.tool_calls?.length) {
            if (message.openaiResponseTurns?.length) {
                for (const turn of message.openaiResponseTurns) {
                    input.push(...turn);
                    appendResults(turn);
                }
            } else {
                if (textContent(message)) input.push({ role: 'assistant', content: textContent(message) });
                const calls = message.tool_calls.map(call => ({ type: 'function_call', call_id: call.id,
                    name: call.function.name, arguments: call.function.arguments, namespace: TOOL_NAMESPACE }));
                input.push(...calls);
                appendResults(calls);
            }
            // The final answer is saved separately after the merged tool rounds.
            if (message.finalReply) input.push({ role: 'assistant', content: message.finalReply });
        } else {
            const content = Array.isArray(message.content) ? message.content.map(part => part.type === 'image_url'
                ? { type: 'input_image', image_url: part.image_url?.url }
                : { type: 'input_text', text: part.text || '' }) : message.content;
            input.push({ role: message.role, content });
        }
    }
    return { instructions, input };
}

export function buildResponsesBody(options: ChatOptions): any {
    const body: any = { model: options.model, ...buildResponsesInput(options.messages),
        store: false, stream: true, include: ['reasoning.encrypted_content'] };
    const functions = (options.tools || []).filter(tool => tool.function?.name).map(tool => ({
        type: 'function', name: tool.function.name, description: tool.function.description || '',
        parameters: tool.function.parameters || { type: 'object', properties: {} }, strict: false,
    }));
    if (functions.length) body.tools = [{ type: 'namespace', name: TOOL_NAMESPACE,
        description: 'Tools enabled and approved by the user in SiYuan Copilot.', tools: functions }];
    if (options.enableThinking) {
        body.reasoning = { summary: 'auto', ...(options.reasoningEffort && options.reasoningEffort !== 'auto'
            ? { effort: options.reasoningEffort } : {}) };
    }
    return body;
}

function streamFailure(event: any, requestId: string): Error {
    const error = event.response?.error || event.error || event;
    const code = error.code || event.response?.incomplete_details?.reason || '';
    const message = code === 'subscription_sharing_usage_limit_exceeded'
        ? i18n('chatgptUsageLimit') : code === 'subscription_sharing_usage_unavailable'
            ? i18n('chatgptUsageUnavailable') : error.message || i18n('chatgptTurnFailed');
    return new ChatGPTHttpError(200, code, message, requestId);
}

/** Parse SSE across arbitrary UTF-8/line boundaries; only response.completed is success. */
export async function consumeResponses(response: any, options: ChatOptions): Promise<void> {
    let buffer = '';
    let data: string[] = [];
    let completed: any;
    const finishedItems = new Map<number, any>();
    let text = '';
    let thinking = '';
    const requestId = response.headers?.['x-request-id'] || '';
    const dispatch = () => {
        if (!data.length) return;
        const payload = data.join('\n');
        data = [];
        if (payload === '[DONE]') return;
        const event = JSON.parse(payload);
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw streamFailure(event, requestId);
        if (event.type === 'response.output_text.delta') {
            text += event.delta;
            options.onChunk?.(event.delta);
        } else if (event.type === 'response.reasoning_summary_text.delta') {
            thinking += event.delta;
            options.onThinkingChunk?.(event.delta);
        } else if (event.type === 'response.output_item.done') {
            if (!Number.isInteger(event.output_index) || event.output_index < 0 || !event.item?.type) {
                throw new Error(i18n('chatgptInvalidResponse'));
            }
            // Keep final items, including encrypted reasoning, even if the terminal output is empty.
            finishedItems.set(event.output_index, event.item);
        } else if (event.type === 'response.completed') {
            if (!event.response || event.response.status !== 'completed') throw streamFailure(event, requestId);
            completed = event.response;
        }
    };
    response.setEncoding('utf8');
    for await (const chunk of response) {
        if (options.signal?.aborted) throw new Error('Request aborted');
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end).replace(/\r$/, '');
            buffer = buffer.slice(end + 1);
            if (line === '') dispatch();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (buffer.length > 8 * 1024 * 1024) throw new Error(i18n('chatgptInvalidResponse'));
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
    dispatch();
    if (options.signal?.aborted) throw new Error('Request aborted');
    if (!completed || !Array.isArray(completed.output)) throw new Error(i18n('chatgptIncompleteStream'));
    // The terminal snapshot and item events describe the same output indexes; never append both.
    completed.output.forEach((item: any, index: number) => {
        finishedItems.set(index, { ...finishedItems.get(index), ...item });
    });
    const output = [...finishedItems.entries()].sort(([left], [right]) => left - right).map(([, item]) => item);
    const calls: ToolCall[] = output.filter(item => item.type === 'function_call').map(item => {
        if ((item.namespace && item.namespace !== TOOL_NAMESPACE) || !item.call_id
            || !options.tools?.some(tool => tool.function?.name === item.name)) {
            throw new Error(i18n('chatgptUnknownTool'));
        }
        return { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
    });
    if (thinking) options.onThinkingComplete?.(thinking);
    if (calls.length) {
        if (!options.onToolCallComplete) throw new Error(i18n('chatgptUnknownTool'));
        await options.onToolCallComplete(calls, output);
    } else {
        if (!text) text = output.filter(item => item.type === 'message')
            .flatMap(item => item.content || []).filter(part => part.type === 'output_text' || part.type === 'refusal')
            .map(part => part.text || part.refusal || '').join('');
        if (!text.trim()) throw new ChatGPTHttpError(200, 'empty_response', i18n('chatgptEmptyResponse'), requestId);
        await options.onComplete?.(text);
    }
}

export async function chatChatGPT(options: ChatOptions): Promise<void> {
    let response: any;
    try {
        response = await getChatGPTClient().authenticatedRequest('responses', {
            body: JSON.stringify(buildResponsesBody(options)), signal: options.signal,
        });
        await consumeResponses(response, options);
    } catch (error) {
        const failure = options.signal?.aborted ? new Error('Request aborted')
            : error instanceof Error ? error : new Error(String(error));
        if (options.onError) options.onError(failure);
        else throw failure;
    } finally { response?.destroy(); }
}
