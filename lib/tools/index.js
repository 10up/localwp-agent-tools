"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.allToolDefinitions = void 0;
exports.handleToolCall = handleToolCall;
const wpcli_1 = require("./wpcli");
const logs_1 = require("./logs");
const config_1 = require("./config");
const site_1 = require("./site");
const environment_1 = require("./environment");
const snapshot_1 = require("./snapshot");
// All tool definitions aggregated
exports.allToolDefinitions = [
    ...wpcli_1.toolDefinitions,
    ...logs_1.toolDefinitions,
    ...config_1.toolDefinitions,
    ...site_1.toolDefinitions,
    ...environment_1.toolDefinitions,
    ...snapshot_1.toolDefinitions,
];
// Build handler map — routes tool name to the correct module
const toolHandlerMap = {};
for (const tool of wpcli_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, _localApi) => (0, wpcli_1.handleTool)(name, args, config);
}
for (const tool of logs_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, _localApi) => (0, logs_1.handleTool)(name, args, config);
}
for (const tool of config_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, _localApi) => (0, config_1.handleTool)(name, args, config);
}
for (const tool of site_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, _localApi) => (0, site_1.handleTool)(name, args, config);
}
for (const tool of environment_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, localApi) => (0, environment_1.handleTool)(name, args, config, localApi);
}
for (const tool of snapshot_1.toolDefinitions) {
    toolHandlerMap[tool.name] = (name, args, config, _localApi) => (0, snapshot_1.handleTool)(name, args, config);
}
/**
 * Handle a tool call, routing to the correct module based on tool name.
 */
function handleToolCall(name, args, config, localApi) {
    return __awaiter(this, void 0, void 0, function* () {
        const handler = toolHandlerMap[name];
        if (!handler) {
            return {
                content: [{
                        type: 'text',
                        text: `Unknown tool: ${name}. Available tools: ${exports.allToolDefinitions.map(t => t.name).join(', ')}`,
                    }],
            };
        }
        return handler(name, args, config, localApi);
    });
}
//# sourceMappingURL=index.js.map