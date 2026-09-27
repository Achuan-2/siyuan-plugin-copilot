import type { Tool } from './index';

export interface SubToolConfig {
    enabled: boolean;
    autoApprove: boolean;
}

export interface ToolConfig {
    name: string;
    autoApprove: boolean;
    subTools?: Record<string, SubToolConfig>;
}

/** MCP tools with an action enum expose each action as a separately configurable subtool. */
export function getSubToolNames(tool: Tool): string[] {
    const actions = tool.function.parameters?.properties?.action?.enum;
    return Array.isArray(actions) && actions.length > 0
        ? actions.filter((action): action is string => typeof action === 'string')
        : [];
}

export function getSubToolConfig(config: ToolConfig | undefined, action: string): SubToolConfig {
    return config?.subTools?.[action] ?? { enabled: true, autoApprove: true };
}

export function filterSelectedTool(tool: Tool, config: ToolConfig): Tool | null {
    const actions = getSubToolNames(tool);
    if (actions.length === 0) return tool;

    const enabledActions = actions.filter(action => getSubToolConfig(config, action).enabled);
    if (enabledActions.length === 0) return null;

    return {
        ...tool,
        function: {
            ...tool.function,
            description: `${tool.function.description}\nEnabled actions: ${enabledActions.join(', ')}. Use only these actions.`,
            parameters: {
                ...tool.function.parameters,
                properties: {
                    ...tool.function.parameters.properties,
                    action: {
                        ...tool.function.parameters.properties.action,
                        enum: enabledActions,
                    },
                },
            },
        },
    };
}
