export declare const toolDefinitions: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
}[];
export declare function handleTool(name: string, _args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
}>;
