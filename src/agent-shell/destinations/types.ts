export type LaunchTarget = {
	siteName: string;
	webRoot: string;
	/** Executable script that loads the site environment and starts the shell or agent. */
	scriptPath: string;
	tabLabel: string;
	home: string;
};
