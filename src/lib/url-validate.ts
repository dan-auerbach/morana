import { URL } from "url";
import dns from "dns/promises";

/**
 * SSRF protection: validate a user-supplied URL before fetching.
 *
 * Blocks:
 * - Non-HTTPS schemes (file://, ftp://, gopher://, etc.)
 * - Private/internal IPs (RFC1918, loopback, link-local, metadata)
 * - DNS rebinding: resolves hostname and checks resolved IPs
 */

const BLOCKED_IP_RANGES = [
  // IPv4
  /^127\./,                          // Loopback
  /^10\./,                           // RFC1918 Class A
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC1918 Class B
  /^192\.168\./,                     // RFC1918 Class C
  /^169\.254\./,                     // Link-local / AWS IMDS
  /^0\./,                            // "This" network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // Shared address space (CGN)
  /^192\.0\.0\./,                    // IETF protocol assignments
  /^198\.1[89]\./,                   // Benchmarking
  /^224\./,                          // Multicast
  /^240\./,                          // Reserved
  /^255\.255\.255\.255$/,            // Broadcast
  // IPv6
  /^::1$/,                           // Loopback
  /^fe80:/i,                         // Link-local
  /^fc00:/i,                         // Unique local (ULA)
  /^fd/i,                            // Unique local (ULA)
  /^::$/,                            // Unspecified
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i, // IPv4-mapped
];

function isBlockedIP(ip: string): boolean {
  for (const pattern of BLOCKED_IP_RANGES) {
    if (pattern.test(ip)) return true;
  }
  return false;
}

export type UrlValidationResult =
  | { valid: true; url: string }
  | { valid: false; reason: string };

/**
 * Validate a URL is safe to fetch (SSRF protection).
 *
 * 1. Only allows https:// scheme
 * 2. Resolves DNS and checks all resolved IPs against blocklist
 * 3. Returns the validated URL string
 */
export async function validateFetchUrl(rawUrl: string): Promise<UrlValidationResult> {
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  // Only HTTPS
  if (parsed.protocol !== "https:") {
    return { valid: false, reason: `Only HTTPS URLs are allowed (got ${parsed.protocol})` };
  }

  // Block credentials in URL
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URLs with credentials are not allowed" };
  }

  // Resolve hostname to check for private IPs (DNS rebinding protection)
  const hostname = parsed.hostname;

  // If hostname is already an IP, check directly
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedIP(hostname)) {
      return { valid: false, reason: "Access to private/internal IPs is not allowed" };
    }
    return { valid: true, url: parsed.toString() };
  }

  // Resolve DNS and check all resolved addresses
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      return { valid: false, reason: "Could not resolve hostname" };
    }

    for (const addr of allAddresses) {
      if (isBlockedIP(addr)) {
        return { valid: false, reason: "URL resolves to a private/internal IP address" };
      }
    }
  } catch {
    return { valid: false, reason: "DNS resolution failed" };
  }

  return { valid: true, url: parsed.toString() };
}
