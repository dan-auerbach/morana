import dns from "dns/promises";
import { sanitizeHtml } from "./sanitize";

// ─── Types ────────────────────────────────────────────────────

export type DrupalPublishResult = {
  nodeId: string;
  nodeUuid: string;
  url?: string;
  status: string;
};

export type DrupalPublishPayload = {
  title: string;
  body_html: string;
  summary?: string;
  status: "draft" | "publish";
  contentType?: string;
  bodyFormat?: string;
};

export type DrupalTestResult = {
  ok: boolean;
  latencyMs: number;
  drupalVersion?: string;
  error?: string;
};

type DrupalConfig = {
  baseUrl: string;
  adapterType: "jsonapi" | "custom_rest";
  authType: "basic" | "bearer_token";
  credentials: { username?: string; password?: string; token?: string };
  defaultContentType: string;
  bodyFormat: string;
  fieldMap?: Record<string, string> | null;
};

// ─── SSRF Protection ──────────────────────────────────────────

const BLOCKED_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^192\.0\.0\./, /^198\.1[89]\./, /^224\./, /^240\./, /^255\.255\.255\.255$/,
  /^::1$/, /^fe80:/i, /^fc00:/i, /^fd/i, /^::$/,
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i,
];

function isBlockedIP(ip: string): boolean {
  return BLOCKED_IP_RANGES.some((p) => p.test(ip));
}

async function validateBaseUrl(baseUrl: string): Promise<void> {
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname;

  // Direct IP check
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedIP(hostname)) {
      throw new Error("Access to private/internal IPs is not allowed");
    }
    return;
  }

  // DNS resolution check
  const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
  const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
  const all = [...addresses, ...addresses6];

  if (all.length === 0) {
    throw new Error("Could not resolve Drupal hostname");
  }

  for (const addr of all) {
    if (isBlockedIP(addr)) {
      throw new Error("Drupal URL resolves to a private/internal IP address");
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function buildAuthHeader(config: DrupalConfig): string {
  if (config.authType === "basic") {
    const { username, password } = config.credentials;
    const encoded = Buffer.from(`${username || ""}:${password || ""}`).toString("base64");
    return `Basic ${encoded}`;
  }
  return `Bearer ${config.credentials.token || ""}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number = 2
): Promise<Response> {
  let lastError: Error | null = null;
  const delays = [1000, 3000]; // exponential backoff

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetchWithTimeout(url, init);

      // Don't retry 4xx errors
      if (resp.status >= 400 && resp.status < 500) {
        return resp;
      }

      // Retry 5xx errors
      if (resp.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Drupal returned ${resp.status}`);
        await new Promise((r) => setTimeout(r, delays[attempt] || 3000));
        continue;
      }

      return resp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delays[attempt] || 3000));
      }
    }
  }

  throw lastError || new Error("Drupal request failed after retries");
}

// ─── DrupalClient ─────────────────────────────────────────────

export class DrupalClient {
  private config: DrupalConfig;

  constructor(config: DrupalConfig) {
    this.config = config;
  }

  /**
   * Test connection to Drupal instance.
   */
  async testConnection(): Promise<DrupalTestResult> {
    const start = Date.now();

    try {
      await validateBaseUrl(this.config.baseUrl);

      const url =
        this.config.adapterType === "jsonapi"
          ? `${this.config.baseUrl}/jsonapi`
          : `${this.config.baseUrl}/morana/health`;

      const resp = await fetchWithTimeout(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.api+json, application/json",
          Authorization: buildAuthHeader(this.config),
        },
      });

      const latencyMs = Date.now() - start;

      if (!resp.ok) {
        return {
          ok: false,
          latencyMs,
          error: `HTTP ${resp.status}: ${resp.statusText}`,
        };
      }

      const drupalVersion =
        resp.headers.get("x-drupal-cache") ||
        resp.headers.get("x-generator") ||
        undefined;

      return { ok: true, latencyMs, drupalVersion };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  /**
   * Publish content to Drupal.
   */
  async publish(payload: DrupalPublishPayload): Promise<DrupalPublishResult> {
    await validateBaseUrl(this.config.baseUrl);

    const sanitizedBody = sanitizeHtml(payload.body_html);
    const contentType = payload.contentType || this.config.defaultContentType;
    const bodyFormat = payload.bodyFormat || this.config.bodyFormat;
    const isPublished = payload.status === "publish";

    if (this.config.adapterType === "custom_rest") {
      return this.publishCustomRest(payload, sanitizedBody);
    }

    return this.publishJsonApi(
      payload,
      sanitizedBody,
      contentType,
      bodyFormat,
      isPublished
    );
  }

  /**
   * Build the JSON:API request body without sending it (for dry-run).
   */
  buildRequestBody(payload: DrupalPublishPayload): unknown {
    const contentType = payload.contentType || this.config.defaultContentType;
    const bodyFormat = payload.bodyFormat || this.config.bodyFormat;
    const isPublished = payload.status === "publish";
    const sanitizedBody = sanitizeHtml(payload.body_html);

    if (this.config.adapterType === "custom_rest") {
      return {
        title: payload.title,
        body_html: sanitizedBody,
        summary: payload.summary || "",
        status: payload.status,
        contentType,
        bodyFormat,
      };
    }

    return {
      data: {
        type: `node--${contentType}`,
        attributes: {
          title: payload.title,
          body: {
            value: sanitizedBody,
            format: bodyFormat,
            summary: payload.summary || "",
          },
          status: isPublished,
        },
      },
    };
  }

  // ─── JSON:API Adapter ───────────────────────────────────────

  private async publishJsonApi(
    payload: DrupalPublishPayload,
    sanitizedBody: string,
    contentType: string,
    bodyFormat: string,
    isPublished: boolean
  ): Promise<DrupalPublishResult> {
    const url = `${this.config.baseUrl}/jsonapi/node/${contentType}`;

    const body = JSON.stringify({
      data: {
        type: `node--${contentType}`,
        attributes: {
          title: payload.title,
          body: {
            value: sanitizedBody,
            format: bodyFormat,
            summary: payload.summary || "",
          },
          status: isPublished,
        },
      },
    });

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
        Authorization: buildAuthHeader(this.config),
      },
      body,
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      throw new Error(
        `Drupal JSON:API error ${resp.status}: ${errorText.slice(0, 500)}`
      );
    }

    const json = await resp.json();
    const data = json.data;

    return {
      nodeId: String(data?.attributes?.drupal_internal__nid || ""),
      nodeUuid: String(data?.id || ""),
      url: data?.links?.self?.href,
      status: isPublished ? "published" : "draft",
    };
  }

  // ─── Custom REST Adapter ────────────────────────────────────

  private async publishCustomRest(
    payload: DrupalPublishPayload,
    sanitizedBody: string
  ): Promise<DrupalPublishResult> {
    const url = `${this.config.baseUrl}/morana/publish`;

    const body = JSON.stringify({
      title: payload.title,
      body_html: sanitizedBody,
      summary: payload.summary || "",
      status: payload.status,
    });

    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildAuthHeader(this.config),
      },
      body,
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      throw new Error(
        `Drupal custom REST error ${resp.status}: ${errorText.slice(0, 500)}`
      );
    }

    const json = await resp.json();

    return {
      nodeId: String(json.nid || ""),
      nodeUuid: String(json.uuid || ""),
      url: json.url,
      status: json.status || payload.status,
    };
  }
}
