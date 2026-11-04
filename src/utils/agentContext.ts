import type { Message, ToolCall } from '../ai-chat';

/** Keep the prepared prompt/history intact and append one protocol-complete tool round. */
export function appendToolRound(
    context: Message[],
    turn: Message,
    results: Message[],
): Message[] {
    const byId = new Map(results
        .filter(message => message.role === 'tool')
        .map(message => [message.tool_call_id, message]));
    const toolResults = (turn.tool_calls || []).map(call => {
        const result = byId.get(call.id);
        if (!result) throw new Error(`Missing result for tool call ${call.id}`);
        return { role: 'tool' as const, tool_call_id: call.id,
            name: call.function.name, content: result.content };
    });
    return [...context, turn, ...toolResults];
}

/** Snapshot before the UI merges rounds and clears its streaming buffers. */
export function createToolRound(
    calls: ToolCall[],
    content: string,
    thinking: string,
    keepReasoning: boolean,
    responseItems?: any[],
): Message {
    return {
        role: 'assistant', content, tool_calls: [...calls],
        ...(keepReasoning ? { reasoning_content: thinking } : {}),
        ...(responseItems ? { openaiResponseTurns: [responseItems] } : {}),
    };
}
