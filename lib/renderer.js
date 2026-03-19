"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.default = default_1;
const react_1 = __importStar(require("react"));
const local_components_1 = require("@getflywheel/local-components");
const AGENT_OPTIONS = [
    { value: 'claude', label: 'Claude Code' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'windsurf', label: 'Windsurf' },
    { value: 'vscode', label: 'VS Code Copilot' },
];
const AGENT_HINTS = {
    claude: 'Restart Claude Code or start a new session to load the MCP server.',
    cursor: 'Enable the MCP in Cursor Settings > Tools & MCP — find "local-wp" and toggle it on.',
    windsurf: 'Enable the MCP in Windsurf Settings > Cascade > MCP Servers — find "local-wp" and toggle it on.',
    vscode: 'Open the Command Palette and run "MCP: List Servers" to verify the server is loaded.',
};
const INSTALL_LOCATION_OPTIONS = {
    '': 'Site Root',
    'app/public': 'WordPress Root (app/public)',
    'app/public/wp-content': 'wp-content',
};
const checkboxStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#ccc',
    cursor: 'pointer',
    marginBottom: 2,
};
const sectionHeadingStyle = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#888',
    margin: '0 0 6px 0',
};
const helperTextStyle = {
    fontSize: 11,
    color: '#888',
    margin: '2px 0 0 0',
};
function AgentToolsPanel({ site, electron }) {
    const [status, setStatus] = (0, react_1.useState)(null);
    const [busy, setBusy] = (0, react_1.useState)(false);
    const [projectDir, setProjectDir] = (0, react_1.useState)('');
    const [selectedAgents, setSelectedAgents] = (0, react_1.useState)(['claude']);
    const fetchStatus = (0, react_1.useCallback)(() => __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield electron.ipcRenderer.invoke('agent-tools:get-status', site.id);
            setStatus(result);
            if (result.projectDir !== undefined) {
                setProjectDir(result.projectDir);
            }
            if (result.agents && result.agents.length > 0) {
                setSelectedAgents(result.agents);
            }
        }
        catch (_a) {
            // ignore
        }
    }), [site.id, electron]);
    (0, react_1.useEffect)(() => {
        fetchStatus();
    }, [fetchStatus]);
    const isEnabled = (status === null || status === void 0 ? void 0 : status.enabled) || false;
    const toggleAgent = (agent) => {
        setSelectedAgents((prev) => {
            if (prev.includes(agent)) {
                return prev.filter((a) => a !== agent);
            }
            return [...prev, agent];
        });
    };
    const handleEnable = (event) => __awaiter(this, void 0, void 0, function* () {
        if (selectedAgents.length === 0)
            return;
        event.target.setAttribute('disabled', 'true');
        setBusy(true);
        try {
            yield electron.ipcRenderer.invoke('agent-tools:enable-site', site.id, projectDir, selectedAgents);
            yield fetchStatus();
        }
        finally {
            setBusy(false);
            event.target.removeAttribute('disabled');
        }
    });
    const handleDisable = (event) => __awaiter(this, void 0, void 0, function* () {
        event.target.setAttribute('disabled', 'true');
        setBusy(true);
        try {
            yield electron.ipcRenderer.invoke('agent-tools:disable-site', site.id);
            yield fetchStatus();
        }
        finally {
            setBusy(false);
            event.target.removeAttribute('disabled');
        }
    });
    const handleRegenerate = (event) => __awaiter(this, void 0, void 0, function* () {
        event.target.setAttribute('disabled', 'true');
        try {
            yield electron.ipcRenderer.invoke('agent-tools:regenerate-config', site.id);
            yield fetchStatus();
        }
        finally {
            event.target.removeAttribute('disabled');
        }
    });
    const handleChangeDir = () => __awaiter(this, void 0, void 0, function* () {
        setBusy(true);
        try {
            yield electron.ipcRenderer.invoke('agent-tools:change-project-dir', site.id, projectDir);
            yield fetchStatus();
        }
        finally {
            setBusy(false);
        }
    });
    // ── Not yet enabled ──────────────────────────────────────────────────
    if (!isEnabled) {
        return (react_1.default.createElement(react_1.default.Fragment, null,
            react_1.default.createElement("div", { style: { marginBottom: 8 } },
                react_1.default.createElement("p", { style: sectionHeadingStyle }, "Coding Agents"),
                AGENT_OPTIONS.map((opt) => (react_1.default.createElement("label", { key: opt.value, style: checkboxStyle },
                    react_1.default.createElement("input", { type: "checkbox", checked: selectedAgents.includes(opt.value), onChange: () => toggleAgent(opt.value) }),
                    opt.label))),
                selectedAgents.length === 0 && (react_1.default.createElement("p", { style: Object.assign(Object.assign({}, helperTextStyle), { color: '#f59e0b' }) }, "Select at least one coding agent."))),
            react_1.default.createElement("div", { style: { marginBottom: 8 } },
                react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                    react_1.default.createElement("span", { style: { fontSize: 12, color: '#999', whiteSpace: 'nowrap' } }, "Install location"),
                    react_1.default.createElement(local_components_1.FlySelect, { value: projectDir, onChange: (value) => setProjectDir(value), options: INSTALL_LOCATION_OPTIONS })),
                react_1.default.createElement("p", { style: helperTextStyle }, "Where MCP config and project context files are placed within the site.")),
            react_1.default.createElement(local_components_1.TextButton, { style: { paddingLeft: 0 }, onClick: handleEnable }, busy ? 'Setting up...' : 'Enable'),
            react_1.default.createElement("p", { style: helperTextStyle }, "Installs an MCP server and project context for AI-powered WordPress development.")));
    }
    // ── Enabled ──────────────────────────────────────────────────────────
    const agentsChanged = (status === null || status === void 0 ? void 0 : status.agents)
        ? selectedAgents.length !== status.agents.length || selectedAgents.some((a) => !status.agents.includes(a))
        : false;
    const handleUpdateAgents = () => __awaiter(this, void 0, void 0, function* () {
        if (selectedAgents.length === 0)
            return;
        setBusy(true);
        try {
            yield electron.ipcRenderer.invoke('agent-tools:update-agents', site.id, selectedAgents);
            yield fetchStatus();
        }
        finally {
            setBusy(false);
        }
    });
    return (react_1.default.createElement(react_1.default.Fragment, null,
        react_1.default.createElement("p", { style: sectionHeadingStyle }, "Settings"),
        react_1.default.createElement("div", { style: { marginBottom: 8 } },
            react_1.default.createElement("label", { style: { fontSize: 12, color: '#999', display: 'block', marginBottom: 3 } }, "Coding agents"),
            AGENT_OPTIONS.map((opt) => (react_1.default.createElement("label", { key: opt.value, style: checkboxStyle },
                react_1.default.createElement("input", { type: "checkbox", checked: selectedAgents.includes(opt.value), onChange: () => toggleAgent(opt.value) }),
                opt.label))),
            agentsChanged && selectedAgents.length > 0 && (react_1.default.createElement(local_components_1.TextButton, { style: { paddingLeft: 0, fontSize: 12, marginTop: 2 }, onClick: handleUpdateAgents }, busy ? 'Updating...' : 'Update')),
            selectedAgents.length === 0 && (react_1.default.createElement("p", { style: Object.assign(Object.assign({}, helperTextStyle), { color: '#f59e0b' }) }, "Select at least one coding agent."))),
        react_1.default.createElement("div", { style: { marginBottom: 8 } },
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                react_1.default.createElement("span", { style: { fontSize: 12, color: '#999', whiteSpace: 'nowrap' } }, "Install location"),
                react_1.default.createElement(local_components_1.FlySelect, { value: projectDir, onChange: (value) => setProjectDir(value), options: INSTALL_LOCATION_OPTIONS })),
            projectDir !== ((status === null || status === void 0 ? void 0 : status.projectDir) || '') && (react_1.default.createElement(local_components_1.TextButton, { style: { paddingLeft: 0, fontSize: 12 }, onClick: handleChangeDir }, busy ? 'Moving...' : 'Apply')),
            react_1.default.createElement("p", { style: helperTextStyle }, "Where MCP config and project context files are placed within the site.")),
        react_1.default.createElement(local_components_1.Divider, { marginSize: "s" }),
        react_1.default.createElement("p", { style: sectionHeadingStyle }, "Next Steps"),
        react_1.default.createElement("div", { style: { marginBottom: 8 } }, ((status === null || status === void 0 ? void 0 : status.agents) || []).map((agent) => {
            var _a;
            return (react_1.default.createElement("p", { key: agent, style: { margin: '3px 0', fontSize: 11, color: '#aaa' } },
                react_1.default.createElement("strong", { style: { color: '#ccc' } }, (_a = AGENT_OPTIONS.find((o) => o.value === agent)) === null || _a === void 0 ? void 0 :
                    _a.label,
                    ":"),
                ' ',
                AGENT_HINTS[agent]));
        })),
        react_1.default.createElement(local_components_1.Divider, { marginSize: "s" }),
        react_1.default.createElement("p", { style: sectionHeadingStyle }, "Actions"),
        react_1.default.createElement(local_components_1.TextButton, { style: { paddingLeft: 0 }, onClick: handleRegenerate }, "Regenerate Config"),
        react_1.default.createElement("p", { style: helperTextStyle }, "Re-generates MCP config and project context. Useful if the agent is having trouble using the tools."),
        react_1.default.createElement(local_components_1.TextButton, { style: { paddingLeft: 0 }, onClick: handleDisable }, "Disable"),
        react_1.default.createElement("p", { style: helperTextStyle }, "Removes Agent Tools config files from this site.")));
}
function default_1(context) {
    const { hooks, electron } = context;
    hooks.addContent('siteInfoUtilities', (site) => {
        return (react_1.default.createElement(local_components_1.TableListRow, { key: "agent-tools", label: "Agent Tools" },
            react_1.default.createElement(AgentToolsPanel, { site: site, electron: electron })));
    });
}
//# sourceMappingURL=renderer.js.map