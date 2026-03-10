export declare const toolDefinitions: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            lines: {
                type: string;
                description: string;
                default: number;
            };
            filter: {
                type: string;
                description: string;
            };
            enable?: undefined;
            debug_log?: undefined;
            script_debug?: undefined;
        };
        required?: undefined;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            enable: {
                type: string;
                description: string;
            };
            debug_log: {
                type: string;
                description: string;
            };
            script_debug: {
                type: string;
                description: string;
            };
            lines?: undefined;
            filter?: undefined;
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
