export declare const toolDefinitions: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            siteId: {
                type: string;
                description: string;
            };
        };
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            siteId?: undefined;
        };
    };
})[];
export declare function handleTool(name: string, args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
}>;
