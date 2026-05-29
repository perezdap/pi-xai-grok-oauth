import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type SimpleStreamOptions,
	streamSimpleOpenAIResponses,
} from "@earendil-works/pi-ai";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exec } from "node:child_process";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_OAUTH_ISSUER = "https://auth.x.ai";
const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`;
const XAI_OAUTH_CLIENT_ID = process.env.PI_XAI_OAUTH_CLIENT_ID || "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_OAUTH_SCOPE = process.env.PI_XAI_OAUTH_SCOPE || "openid profile email offline_access grok-cli:access api:access";
const CALLBACK_HOST = process.env.PI_XAI_OAUTH_CALLBACK_HOST || "127.0.0.1";
const CALLBACK_PORT = Number.parseInt(process.env.PI_XAI_OAUTH_CALLBACK_PORT || "56121", 10);
const CALLBACK_PATH = "/callback";
const REFRESH_SKEW_MS = 120_000;

type XaiDiscovery = {
	authorization_endpoint: string;
	token_endpoint: string;
};

type XaiOAuthCredentials = OAuthCredentials & {
	tokenEndpoint?: string;
	discovery?: XaiDiscovery;
	idToken?: string;
	tokenType?: string;
	baseUrl?: string;
};

type XaiModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
};

const GROK_BUILD_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const GROK_43_COST = { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 };
const GROK_420_COST = { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 };

const DEFAULT_MODELS: XaiModel[] = [
	{
		id: "grok-build",
		name: "Grok Build",
		reasoning: true,
		input: ["text"],
		cost: GROK_BUILD_COST,
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	},
	{
		id: "grok-4.3",
		name: "Grok 4.3",
		reasoning: true,
		input: ["text"],
		cost: GROK_43_COST,
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	},
	{
		id: "grok-4.20-0309-reasoning",
		name: "Grok 4.20 Reasoning",
		reasoning: true,
		input: ["text"],
		cost: GROK_420_COST,
		contextWindow: 2_000_000,
		maxTokens: 30_000,
	},
	{
		id: "grok-4.20-0309-non-reasoning",
		name: "Grok 4.20 Non-Reasoning",
		reasoning: false,
		input: ["text"],
		cost: GROK_420_COST,
		contextWindow: 2_000_000,
		maxTokens: 30_000,
		thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: null, xhigh: null },
	},
	{
		id: "grok-4.20-multi-agent-0309",
		name: "Grok 4.20 Multi-Agent",
		reasoning: true,
		input: ["text"],
		cost: GROK_420_COST,
		contextWindow: 2_000_000,
		maxTokens: 30_000,
	},
];

let liveModelsCache: XaiModel[] | null = null;
let liveModelsCacheToken: string | undefined;
let liveModelsRefreshPromise: Promise<{ models: XaiModel[]; live: boolean }> | null = null;
let lastXaiCredentials: XaiOAuthCredentials | undefined;

function getXaiAccessToken(credentials?: XaiOAuthCredentials): string {
	return credentials?.access || process.env.XAI_OAUTH_TOKEN || process.env.PI_XAI_OAUTH_TOKEN || "";
}

function configuredModels(): XaiModel[] {
	const configured = (process.env.PI_XAI_OAUTH_MODELS || "")
		.split(",")
		.map((m) => m.trim())
		.filter(Boolean);

	if (configured.length === 0) return DEFAULT_MODELS;

	const byId = new Map(DEFAULT_MODELS.map((m) => [m.id, m]));
	return configured.map((id) => byId.get(id) ?? {
		id,
		name: id,
		reasoning: true,
		input: ["text"],
		cost: GROK_BUILD_COST,
		contextWindow: 1_000_000,
		maxTokens: 30_000,
	});
}

function activeModels(): XaiModel[] {
	return liveModelsCache ?? configuredModels();
}

function toProviderModelConfig(model: XaiModel) {
	return {
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		thinkingLevelMap: model.thinkingLevelMap,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

function toRuntimeModel(model: XaiModel, baseUrl: string): Model<Api> {
	return {
		...toProviderModelConfig(model),
		provider: "xai-oauth",
		api: "xai-oauth-responses",
		baseUrl,
	};
}

function base64Url(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

function randomState(): string {
	return randomBytes(16).toString("hex");
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") || undefined,
			state: url.searchParams.get("state") || undefined,
		};
	} catch {
		// Not a URL; fall through.
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") || undefined,
			state: params.get("state") || undefined,
		};
	}
	return { code: value };
}

function validateXaiEndpoint(value: string, field: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`xAI OAuth discovery returned invalid ${field}: ${value}`);
	}
	if (url.protocol !== "https:") throw new Error(`xAI OAuth ${field} must use HTTPS.`);
	const host = url.hostname.toLowerCase();
	if (host !== "auth.x.ai" && host !== "accounts.x.ai" && !host.endsWith(".x.ai")) {
		throw new Error(`Refusing non-xAI OAuth ${field}: ${value}`);
	}
	return url.toString();
}

async function discoverXaiOAuth(): Promise<XaiDiscovery> {
	const response = await fetch(XAI_OAUTH_DISCOVERY_URL, { headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`xAI OIDC discovery failed: ${response.status} ${await response.text()}`);
	const payload = await response.json() as Partial<XaiDiscovery>;
	const authorizationEndpoint = validateXaiEndpoint(String(payload.authorization_endpoint || ""), "authorization_endpoint");
	const tokenEndpoint = validateXaiEndpoint(String(payload.token_endpoint || ""), "token_endpoint");
	return { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint };
}

function callbackHtml(title: string, body: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

function setCors(req: IncomingMessage, res: ServerResponse) {
	const origin = req.headers.origin;
	if (origin === "https://accounts.x.ai" || origin === "https://auth.x.ai") {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.setHeader("Access-Control-Allow-Private-Network", "true");
		res.setHeader("Vary", "Origin");
	}
}

async function startCallbackServer(): Promise<{
	server: Server;
	redirectUri: string;
	waitForCallback: (timeoutMs: number) => Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
}> {
	let settle: ((value: { code?: string; state?: string; error?: string; errorDescription?: string }) => void) | undefined;
	const callbackPromise = new Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>((resolve) => {
		settle = resolve;
	});

	const server = createServer((req, res) => {
		try {
			setCors(req, res);
			if (req.method === "OPTIONS") {
				res.statusCode = 204;
				res.end();
				return;
			}
			const url = new URL(req.url || "/", `http://${CALLBACK_HOST}`);
			if (url.pathname !== CALLBACK_PATH) {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}
			const result = {
				code: url.searchParams.get("code") || undefined,
				state: url.searchParams.get("state") || undefined,
				error: url.searchParams.get("error") || undefined,
				errorDescription: url.searchParams.get("error_description") || undefined,
			};
			res.statusCode = result.error ? 400 : 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(result.error
				? callbackHtml("xAI authorization failed", "You can close this tab and return to pi.")
				: callbackHtml("xAI authorization received", "You can close this tab and return to pi."));
			settle?.(result);
		} catch (error) {
			res.statusCode = 500;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(callbackHtml("xAI authorization error", error instanceof Error ? error.message : String(error)));
		}
	});

	const listen = (port: number) => new Promise<number>((resolve, reject) => {
		const onError = (err: Error) => {
			server.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.off("error", onError);
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : port);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, CALLBACK_HOST);
	});

	let actualPort: number;
	try {
		actualPort = await listen(CALLBACK_PORT);
	} catch {
		actualPort = await listen(0);
	}

	const redirectUri = `http://${CALLBACK_HOST}:${actualPort}${CALLBACK_PATH}`;
	return {
		server,
		redirectUri,
		waitForCallback: async (timeoutMs: number) => Promise.race([
			callbackPromise,
			new Promise<{ error: string; errorDescription: string }>((resolve) => {
				setTimeout(() => resolve({ error: "timeout", errorDescription: "Timed out waiting for xAI OAuth callback." }), timeoutMs);
			}),
		]),
	};
}

async function exchangeCodeForTokens(tokenEndpoint: string, code: string, redirectUri: string, verifier: string): Promise<XaiOAuthCredentials> {
	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: XAI_OAUTH_CLIENT_ID,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		}),
	});
	if (!response.ok) throw new Error(`xAI token exchange failed: ${response.status} ${await response.text()}`);
	const payload = await response.json() as Record<string, unknown>;
	const access = String(payload.access_token || "");
	const refresh = String(payload.refresh_token || "");
	if (!access) throw new Error("xAI token exchange did not return access_token.");
	if (!refresh) throw new Error("xAI token exchange did not return refresh_token.");
	const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in || 3600);
	return {
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
		tokenEndpoint,
		idToken: String(payload.id_token || ""),
		tokenType: String(payload.token_type || "Bearer"),
		baseUrl: getXaiBaseUrl(),
	};
}

/**
 * Robustly open a URL in the default browser.
 * Handles Windows quoting issues that prevent `start "url"` from working.
 */
function openBrowser(url: string): void {
	let command: string;
	switch (process.platform) {
		case "darwin":
			command = `open "${url}"`;
			break;
		case "win32":
			// Empty title ("") prevents the URL from being treated as the window title
			command = `cmd.exe /c start "" "${url.replace(/"/g, '\\"')}"`;
			break;
		default:
			command = `xdg-open "${url}"`;
			break;
	}
	exec(command, (error) => {
		if (error) {
			console.warn(`[pi-xai-grok-oauth] Auto-open browser failed: ${error.message}. Please open the URL manually.`);
		}
	});
}

async function loginXai(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const discovery = await discoverXaiOAuth();
	const { verifier, challenge } = generatePKCE();
	const state = randomState();
	const nonce = randomState();
	const callback = await startCallbackServer();

	try {
		const authUrl = new URL(discovery.authorization_endpoint);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("client_id", XAI_OAUTH_CLIENT_ID);
		authUrl.searchParams.set("redirect_uri", callback.redirectUri);
		authUrl.searchParams.set("scope", XAI_OAUTH_SCOPE);
		authUrl.searchParams.set("code_challenge", challenge);
		authUrl.searchParams.set("code_challenge_method", "S256");
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set("nonce", nonce);
		authUrl.searchParams.set("plan", "generic");
		authUrl.searchParams.set("referrer", "pi-xai-grok-oauth");

		openBrowser(authUrl.toString());
		callbacks.onAuth({
			url: authUrl.toString(),
			instructions: `Authorize xAI, then return to pi. Callback listener: ${callback.redirectUri}`,
		});

		const manualInput = typeof (callbacks as any).onManualCodeInput === "function"
			? (callbacks as any).onManualCodeInput().then((input: string) => ({ manual: parseAuthorizationInput(input) })).catch(() => undefined)
			: undefined;
		const callbackInput = callback.waitForCallback(180_000).then((result) => ({ callback: result }));
		const first = manualInput ? await Promise.race([callbackInput, manualInput]) : await callbackInput;
		const result = first && "manual" in first ? first.manual : first?.callback;
		if (!result) throw new Error("xAI OAuth login was cancelled.");
		if ("error" in result && result.error) throw new Error(result.errorDescription || result.error);
		if (result.state && result.state !== state) throw new Error("xAI OAuth state mismatch.");
		if (!result.code) throw new Error("xAI OAuth callback did not include an authorization code.");

		const credentials = await exchangeCodeForTokens(discovery.token_endpoint, result.code, callback.redirectUri, verifier);
		credentials.discovery = discovery;
		await refreshLiveModelCache(credentials, { force: true });
		return credentials;
	} finally {
		callback.server.close();
	}
}

async function refreshXaiToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const xaiCredentials = credentials as XaiOAuthCredentials;
	const tokenEndpoint = xaiCredentials.tokenEndpoint || xaiCredentials.discovery?.token_endpoint || (await discoverXaiOAuth()).token_endpoint;
	validateXaiEndpoint(tokenEndpoint, "token_endpoint");

	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: XAI_OAUTH_CLIENT_ID,
			refresh_token: credentials.refresh,
		}),
	});
	if (!response.ok) throw new Error(`xAI token refresh failed: ${response.status} ${await response.text()}`);
	const payload = await response.json() as Record<string, unknown>;
	const access = String(payload.access_token || "");
	if (!access) throw new Error("xAI token refresh did not return access_token.");
	const refresh = String(payload.refresh_token || credentials.refresh);
	const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in || 3600);
	const refreshed: XaiOAuthCredentials = {
		...xaiCredentials,
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS,
		tokenEndpoint,
		idToken: String(payload.id_token || xaiCredentials.idToken || ""),
		tokenType: String(payload.token_type || xaiCredentials.tokenType || "Bearer"),
		baseUrl: getXaiBaseUrl(),
	};
	await refreshLiveModelCache(refreshed, { force: true });
	return refreshed;
}

function getXaiBaseUrl(): string {
	return (process.env.PI_XAI_BASE_URL || process.env.XAI_BASE_URL || DEFAULT_XAI_BASE_URL).replace(/\/+$/, "");
}

async function fetchLiveXaiModels(credentials?: XaiOAuthCredentials): Promise<XaiModel[]> {
	const token = getXaiAccessToken(credentials);
	if (!token) throw new Error("No xAI access token available.");

	const baseUrl = credentials?.baseUrl || getXaiBaseUrl();
	const response = await fetch(`${baseUrl}/models`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});

	if (!response.ok) throw new Error(`HTTP ${response.status}`);

	const data = await response.json() as { data?: unknown };
	const rows = Array.isArray(data.data) ? data.data : [];

	const liveModels = rows
		.filter((m: any) => m.id && String(m.id).toLowerCase().includes("grok"))
		.sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));

	if (liveModels.length === 0) throw new Error("xAI /models returned no Grok models.");

	return liveModels.map((m: any) => {
		const id = String(m.id);
		const isMultiAgent = id.includes("multi-agent");
		const isNonReasoning = id.includes("non-reasoning");
		const isBuild = id.includes("build");
		const is43 = id.includes("4.3");

		return {
			id,
			name: id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
			reasoning: !isNonReasoning,
			input: ["text"] as const,
			cost: isBuild ? GROK_BUILD_COST : is43 ? GROK_43_COST : GROK_420_COST,
			contextWindow: (id.includes("4.20") || isMultiAgent) ? 2_000_000 : 1_000_000,
			maxTokens: 32_000,
			thinkingLevelMap: isNonReasoning ? {
				off: "none",
				minimal: null,
				low: null,
				medium: null,
				high: null,
				xhigh: null,
			} : undefined,
		};
	});
}

async function refreshLiveModelCache(
	credentials?: XaiOAuthCredentials,
	options: { force?: boolean } = {},
): Promise<{ models: XaiModel[]; live: boolean; error?: unknown }> {
	if (credentials) lastXaiCredentials = credentials;
	const effectiveCredentials = credentials ?? lastXaiCredentials;
	const token = getXaiAccessToken(effectiveCredentials);

	if (!token) {
		return { models: activeModels(), live: false, error: new Error("No xAI access token available.") };
	}

	// Skip live fetch if token is expired — pi core will refresh before actual API calls
	if (effectiveCredentials?.expires && Date.now() > effectiveCredentials.expires) {
		return { models: activeModels(), live: false };
	}

	if (!options.force && liveModelsCache && liveModelsCacheToken === token) {
		return { models: liveModelsCache, live: true };
	}

	try {
		const models = await fetchLiveXaiModels(effectiveCredentials);
		liveModelsCache = models;
		liveModelsCacheToken = token;
		return { models, live: true };
	} catch (err: any) {
		const msg = err.message || String(err);
		const isAuthError = /\b(401|403)\b/.test(msg);
		// Auth errors usually mean the token is expired or lacks /models scope.
		// pi's core will refresh the token before chat API calls, so don't warn here.
		if (!isAuthError) {
			console.warn("[pi-xai-grok-oauth] Failed to fetch live models; keeping cached/configured models:", msg);
		}
		// Clear stale cache on auth errors so we retry fresh after the next login/refresh
		if (isAuthError) {
			liveModelsCache = null;
			liveModelsCacheToken = undefined;
		}
		return { models: activeModels(), live: false, error: err };
	}
}

function refreshLiveModelCacheInBackground(credentials?: XaiOAuthCredentials, onRefresh?: (models: XaiModel[]) => void): void {
	if (credentials) lastXaiCredentials = credentials;
	const effectiveCredentials = credentials ?? lastXaiCredentials;
	const token = getXaiAccessToken(effectiveCredentials);
	if (!token || (liveModelsCache && liveModelsCacheToken === token)) return;

	liveModelsRefreshPromise ??= refreshLiveModelCache(effectiveCredentials).finally(() => {
		liveModelsRefreshPromise = null;
	});
	void liveModelsRefreshPromise.then((result) => {
		if (result.live) onRefresh?.(result.models);
	});
}

/**
 * Dynamically fetch the exact list of models available on this xAI account.
 * Falls back to cached/configured defaults when live discovery is unavailable.
 */
export async function listLiveXaiModels(credentials?: XaiOAuthCredentials): Promise<XaiModel[]> {
	return (await refreshLiveModelCache(credentials, { force: true })).models;
}

const GROK_EFFORT_CAPABLE_PREFIXES = ["grok-3-mini", "grok-4.20-multi-agent", "grok-4.3"];

function grokSupportsReasoningEffort(modelId: string): boolean {
	let name = modelId.trim().toLowerCase();
	if (name.includes("/")) name = name.split("/").pop() || name;
	return GROK_EFFORT_CAPABLE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function sanitizeXaiResponsesPayload(params: any, model: Model<Api>): any {
	const next = { ...params };
	let hasStrippedImages = false;

	// xAI's Responses surface rejects replayed encrypted reasoning items and
	// should not be asked to return them. Grok still reasons natively; only a
	// small allowlist accepts the effort dial.
	// xAI Responses API currently rejects image inputs (causes 422 ModelInput errors).
	// Models declare only text input so pi never sends images, but we keep a
	// defensive stripper as a safety net.
	if (Array.isArray(next.input)) {
		next.input = next.input.map((item: any) => {
			if (!item || typeof item !== "object") return item;

			// Strip reasoning items
			if (item.type === "reasoning") return null;

			// Catch items that are themselves image containers (e.g. standalone image messages or read results)
			if (item.type === "image" || item.image || item.source?.type === "base64" || (item.url && String(item.url).startsWith("data:image"))) {
				hasStrippedImages = true;
				return {
					type: "input_text",
					text: "[Image input omitted — xAI Responses API does not support image uploads]",
				};
			}

			// Handle user/assistant messages with a content array
			if (Array.isArray(item.content)) {
				const sanitizedContent = item.content
					.map((part: any) => {
						if (!part || typeof part !== "object") return part;
						const t = part.type;
						if (t === "input_image" || t === "image_url" || t === "image" || (t && String(t).includes("image"))) {
							hasStrippedImages = true;
							return {
								type: "input_text",
								text: "[Image input omitted — xAI Responses API does not support image uploads]",
							};
						}
						// Catch other image representations (e.g. clipboard reads, data URLs, file refs)
						if (part.image || part.image_url || part.source?.type === "base64" || (typeof part.text === "string" && part.text.startsWith("data:image"))) {
							hasStrippedImages = true;
							return {
								type: "input_text",
								text: "[Image input omitted — xAI Responses API does not support image uploads]",
							};
						}
						return part;
					})
					.filter(Boolean);

				// Drop empty content arrays entirely
				if (sanitizedContent.length === 0) return null;

				return { ...item, content: sanitizedContent };
			}

			// Strip empty string content
			if (typeof item.content === "string" && item.content.length === 0) return null;

			return item;
		}).filter(Boolean);
	}

	if (hasStrippedImages) {
		console.warn("[xai-grok-oauth] Images were stripped from the request because xAI's Responses API does not support them.");
	}

	if (grokSupportsReasoningEffort(model.id)) {
		if (next.reasoning?.effort === "minimal") next.reasoning = { ...next.reasoning, effort: "low" };
		if (next.reasoning?.summary) next.reasoning = { effort: next.reasoning.effort };
	} else {
		delete next.reasoning;
	}
	delete next.include;
	return next;
}

function streamXaiOAuth(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const sessionId = options?.sessionId;
	const headers = {
		...options?.headers,
		...(sessionId ? { "x-grok-conv-id": sessionId } : {}),
	};
	return streamSimpleOpenAIResponses(model as Model<"openai-responses">, context, {
		...options,
		headers,
		onPayload: async (params, payloadModel) => {
			const previous = await options?.onPayload?.(params, payloadModel);
			return sanitizeXaiResponsesPayload(previous ?? params, model);
		},
	});
}

export default function (pi: ExtensionAPI) {
	const registerXaiProvider = (models: XaiModel[] = activeModels()) => {
		pi.registerProvider("xai-oauth", {
			name: "xAI Grok OAuth (SuperGrok Subscription)",
			baseUrl: getXaiBaseUrl(),
			apiKey: "XAI_OAUTH_TOKEN",
			api: "xai-oauth-responses",
			models: models.map(toProviderModelConfig),
			oauth: {
				name: "xAI Grok OAuth (SuperGrok Subscription)",
				usesCallbackServer: true,
				login: async (callbacks: OAuthLoginCallbacks) => {
					const credentials = await loginXai(callbacks) as XaiOAuthCredentials;
					registerXaiProvider(activeModels());
					return credentials;
				},
				refreshToken: async (credentials: OAuthCredentials) => {
					const refreshed = await refreshXaiToken(credentials) as XaiOAuthCredentials;
					registerXaiProvider(activeModels());
					return refreshed;
				},
				getApiKey: (credentials: OAuthCredentials) => credentials.access,
				modifyModels: (allModels: Model<Api>[], credentials: OAuthCredentials) => {
					const xaiCreds = credentials as XaiOAuthCredentials;
					lastXaiCredentials = xaiCreds;
					refreshLiveModelCacheInBackground(xaiCreds, (freshModels) => registerXaiProvider(freshModels));

					const baseUrl = String(xaiCreds.baseUrl || getXaiBaseUrl()).replace(/\/+$/, "");
					const source = activeModels();
					const liveById = new Map(source.map((m) => [m.id, m]));
					const existingXaiIds = new Set(allModels.filter((m) => m.provider === "xai-oauth").map((m) => m.id));

					const updated = allModels.map((m: Model<Api>) => {
						if (m.provider !== "xai-oauth") return m;
						const live = liveById.get(m.id);
						if (!live) return { ...m, baseUrl };
						return {
							...m,
							name: live.name,
							reasoning: live.reasoning,
							thinkingLevelMap: live.thinkingLevelMap,
							input: live.input,
							cost: live.cost,
							contextWindow: live.contextWindow,
							maxTokens: live.maxTokens,
							baseUrl,
						};
					});

					const additions = source
						.filter((m) => !existingXaiIds.has(m.id))
						.map((m) => toRuntimeModel(m, baseUrl));

					return [...updated, ...additions];
				},
			} as any,
			streamSimple: streamXaiOAuth,
		});
	};

	registerXaiProvider();

	pi.registerCommand("xai-models", {
		description: "Show and refresh the Grok models currently available on your xAI account",
		handler: async (_args, ctx) => {
			const result = await refreshLiveModelCache(lastXaiCredentials, { force: true });
			registerXaiProvider(result.models);

			console.log(result.live ? "\n=== Live xAI Grok Models ===" : "\n=== xAI Grok Models (cached/configured fallback) ===");
			console.table(result.models.map((m) => ({
				id: m.id,
				name: m.name,
				reasoning: m.reasoning,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			})));

			if (result.live) {
				ctx.ui.notify(`Found ${result.models.length} live Grok model(s). The model picker has been updated.`, "info");
			} else {
				ctx.ui.notify("Could not fetch live models. Using cached/configured models; run /login xai-oauth if needed.", "warning");
			}
		},
	});
}
