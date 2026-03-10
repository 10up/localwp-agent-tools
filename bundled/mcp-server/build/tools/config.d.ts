export declare const toolDefinitions: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            raw: {
                type: string;
                description: string;
                default: boolean;
            };
            name?: undefined;
            value?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            name: {
                type: string;
                description: string;
            };
            value: {
                type: string;
                description: string;
            };
            raw?: undefined;
        };
        required: string[];
    };
})[];
export declare function handleTool(name: string, args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
}>;
