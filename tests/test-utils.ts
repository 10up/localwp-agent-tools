import * as http from 'http';
import * as net from 'net';

/**
 * Finds a free TCP port on 127.0.0.1 by binding to port 0 and releasing it.
 * There's a small TOCTOU race between release and reuse — acceptable for
 * tests (the same tradeoff `findAvailablePort` makes in production).
 */
export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			srv.close(() => resolve(port));
		});
	});
}

export interface TestRequestOptions {
	method: string;
	path: string;
	headers?: Record<string, string>;
	body?: string;
}

export interface TestResponse {
	statusCode: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

export function makeRequest(port: number, options: TestRequestOptions): Promise<TestResponse> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path: options.path,
				method: options.method,
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('end', () => {
					resolve({
						statusCode: res.statusCode || 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString('utf-8'),
					});
				});
			},
		);
		req.on('error', reject);
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

/**
 * Like `makeRequest`, but resolves as soon as response headers arrive instead
 * of waiting for the body to end. Needed for the SSE GET stream, which the
 * server keeps open indefinitely once authorized — waiting for 'end' would
 * hang the test forever. Destroys the socket right after capturing the
 * status/headers, since the test only needs to prove the connection was
 * authorized, not consume the stream.
 */
export function makeStreamingRequest(
	port: number,
	options: TestRequestOptions,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		let settled = false;

		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path: options.path,
				method: options.method,
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
			},
			(res) => {
				settled = true;
				const statusCode = res.statusCode || 0;
				const headers = res.headers;
				res.destroy();
				req.destroy();
				resolve({ statusCode, headers });
			},
		);
		req.on('error', (err) => {
			// Destroying the response above can surface as a socket error on the
			// request side once we've already resolved — only reject if we
			// haven't captured a response yet.
			if (!settled) reject(err);
		});
		if (options.body) {
			req.write(options.body);
		}
		req.end();
	});
}

/**
 * Sends a raw HTTP/1.0 request over a bare TCP socket, bypassing Node's
 * `http` client. `http.request` always injects a `Host` header for HTTP/1.1
 * requests, and Node's own HTTP/1.1 server-side parser rejects any HTTP/1.1
 * request that lacks one with a 400 before it ever reaches our handler.
 * HTTP/1.0 has no such requirement, so this is the only way to exercise the
 * "missing Host header" branch of the server's own DNS-rebinding check.
 */
export function makeRawRequest(
	port: number,
	options: { method: string; path: string; headers?: Record<string, string> },
): Promise<TestResponse> {
	return new Promise((resolve, reject) => {
		const headerLines = Object.entries(options.headers || {}).map(([key, value]) => `${key}: ${value}`);
		const request = [`${options.method} ${options.path} HTTP/1.0`, ...headerLines, '', ''].join('\r\n');

		const socket = net.connect(port, '127.0.0.1', () => {
			socket.write(request);
		});

		let raw = '';
		socket.on('data', (chunk: Buffer) => {
			raw += chunk.toString('utf-8');
		});
		socket.on('end', () => {
			const [head, ...bodyParts] = raw.split('\r\n\r\n');
			const body = bodyParts.join('\r\n\r\n');
			const [statusLine, ...rawHeaderLines] = head.split('\r\n');
			const statusCode = Number(statusLine.split(' ')[1]);
			const headers: http.IncomingHttpHeaders = {};
			for (const line of rawHeaderLines) {
				const idx = line.indexOf(':');
				if (idx === -1) continue;
				headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
			}
			resolve({ statusCode, headers, body });
		});
		socket.on('error', reject);
	});
}
