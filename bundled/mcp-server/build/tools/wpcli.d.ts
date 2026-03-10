export declare const toolDefinitions: {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            args: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
}[];
export declare function handleTool(name: string, args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
}>;
