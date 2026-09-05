// Generic, SSRF-hardened outbound HTTP(S) fetch — the only way anything
// in this project ever contacts a restaurant's own website (currently:
// the MARKET-05A "Suggest data from website" feature,
// app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js).
// Never used for any automatic/scheduled fetch — every call is the
// direct, synchronous result of one explicit internal-reviewer button
// click; nothing here ever fires on candidate load or on a timer.
//
// Defense-in-depth against SSRF, in order:
//  1. `isSafeUrlShape` — protocol must be http(s), no embedded
//     credentials, rejects `localhost`/`*.localhost` outright (a
//     well-known loopback alias a DNS lookup wouldn't otherwise catch),
//     **and — corrected 2026-09-06 — rejects a literal IPv4 or IPv6 host
//     address directly, right here, checked against
//     `buildDisallowedIpBlockList`'s ranges before any request is ever
//     issued.** This literal-host check is not optional/redundant: Node's
//     `http(s).request()` does not invoke a custom `lookup` option at all
//     when the target host is already a literal IP (no DNS resolution is
//     needed) — confirmed directly against this Node runtime — so a
//     request to `http://127.0.0.1/` would otherwise bypass the guarded
//     lookup in point 2 below entirely. This was a real gap in the first
//     version of this file (guarded lookup only), found and closed the
//     same day.
//  2. A custom Node `lookup` function (`createGuardedLookup`) is passed
//     to every `http(s).request()` call — Node calls this instead of
//     `dns.lookup()` internally, and refuses to open a socket at all if
//     it errors. This is the defense against DNS rebinding specifically:
//     a *hostname* (never a literal IP — see point 1) that resolves to a
//     private/loopback/link-local address is rejected *before* any TCP
//     connection is attempted.
//  3. Only zero or a small, fixed number of redirects are followed
//     (`maxRedirects`, default 3) — every redirect target is
//     independently re-validated by both (1) and (2) above, exactly
//     like the initial URL; a redirect to a disallowed address (literal
//     or resolved) is refused exactly the same way the initial request
//     would have been.
//  4. Response size is capped (`maxBytes`, default 2 MB) — the
//     connection is destroyed the instant the cap is exceeded, never
//     buffering an unbounded response.
//  5. A hard timeout (`timeoutMs`, default 8000) aborts a
//     stalled/slow-loris-style connection.
//  6. No cookies, no `Authorization` header, no browser-like session
//     state of any kind is ever sent or persisted — each call is a
//     single, stateless, anonymous request with a fixed, honest
//     `User-Agent` identifying this feature (never a browser-spoofing
//     UA), and nothing from the response (e.g. `Set-Cookie`) is ever
//     stored or forwarded anywhere.
//
// The IP-range logic itself (`isDisallowedIp` and friends) is built on
// Node's own `net.BlockList`, covering the IANA IPv4/IPv6
// "Special-Purpose Address Registry" ranges — loopback, private-use,
// link-local (including the `169.254.169.254` cloud metadata address),
// shared/CGNAT space, multicast, unspecified, documentation/benchmarking,
// protocol-assignment/anycast/transition ranges (AS112, AMT, 6to4,
// Teredo, NAT64, ORCHIDv2, SRv6, etc.), and other reserved blocks — see
// `buildDisallowedIpBlockList`'s own comment for the exact list and the
// fail-closed policy behind it (every IANA special-purpose range is
// disallowed as a destination, whether or not it happens to be
// technically routable). `BlockList.check()` correctly unwraps an
// IPv4-mapped IPv6 address in *either* dotted-decimal or Node's own
// canonical hex form (e.g. `::ffff:7f00:1`) against the IPv4 rules —
// verified directly against this Node runtime in this file's own test
// suite, not assumed.
//
// Correction (2026-09-12): the block list above previously covered only
// the most common special-purpose ranges and was missing several
// IANA-registered ones (IPv4: AS112-v4, AMT, AS112 direct-delegation;
// IPv6: most `2001::/23` sub-ranges, the second NAT64 range, 6to4, the
// second AS112 direct-delegation range, and the newer SRv6/documentation
// ranges) — see `buildDisallowedIpBlockList` for the now-complete list
// and full detail.
//
// Deliberately CommonJS — see src/lib/importInbox.js's own header
// comment for why.

'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { URL } = require('node:url');

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

// Never a browser UA — this must always be honestly identifiable as an
// automated fetch, on request from a human reviewer, for exactly this
// feature.
const USER_AGENT = 'MenuCardInternalSuggestBot/1.0 (+internal candidate data suggestion feature)';

class SafeFetchError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'SafeFetchError';
    this.reason = reason;
  }
}

// ─── IP-range checks (pure) ─────────────────────────────────────────────
//
// Built on Node's own `net.BlockList` (stable since Node 15) rather than
// hand-rolled regex/range arithmetic — its subnet-matching is Node's own
// tested implementation, and critically, `BlockList.check()` already
// correctly unwraps an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, in
// *either* dotted-decimal or Node's own canonical hex form, e.g.
// `::ffff:7f00:1` — confirmed directly against this Node runtime, see
// this file's own test suite) against the IPv4 subnets below, with no
// separate embedded-address-extraction code needed here at all.

/**
 * One shared BlockList covering the IANA IPv4 and IPv6 "Special-Purpose
 * Address Registry" ranges this project must never connect to: loopback,
 * private-use, link-local (including the `169.254.169.254` cloud
 * metadata endpoint), shared/CGNAT address space, multicast, the
 * unspecified address, documentation/benchmarking ranges, protocol-
 * specific transition/anycast ranges (AS112, AMT, 6to4, Teredo, NAT64,
 * ORCHIDv2, SRv6, etc.), and other IETF-reserved blocks. Built once at
 * module load.
 *
 * **Policy — corrected 2026-09-12: this list must track the full IANA
 * registries, not a hand-picked subset.** For this feature (an internal,
 * server-side fetcher that only ever needs to reach a candidate
 * restaurant's own public website), every range in the IANA IPv4/IPv6
 * "Special-Purpose Address Registry" is disallowed as a destination —
 * including ranges that are technically globally routable in some
 * deployments (e.g. `192.0.0.0/24`'s IETF protocol-assignment
 * sub-ranges, AS112/AMT/6to4/Teredo anycast and relay ranges). There is
 * no legitimate reason for this feature to ever connect to any of them,
 * so the policy is "deny the entire registry," not "deny only the
 * ranges known to be non-routable." An earlier version of this list
 * covered only the most common ranges (RFC 1918 private space, loopback,
 * link-local, documentation/benchmarking, multicast) and was missing
 * several IANA-registered ranges entirely (IPv4: AS112-v4, AMT, AS112
 * direct-delegation; IPv6: most of the `2001::/23` IETF-protocol-
 * assignment sub-ranges, the second NAT64 range, 6to4, the second AS112
 * direct-delegation range, and the newer SRv6/documentation ranges) —
 * closed here. Sourced from the IANA IPv4 Special-Purpose Address
 * Registry and IANA IPv6 Special-Purpose Address Registry as published
 * at the time of this fix; since IANA occasionally adds new entries
 * (most recently e.g. RFC 9374/9602/9637), this list should be
 * re-diffed against the live registries periodically — it is not
 * expected to silently stay complete forever.
 */
function buildDisallowedIpBlockList() {
  const blockList = new net.BlockList();

  // IPv4 — IANA IPv4 Special-Purpose Address Registry.
  blockList.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
  blockList.addSubnet('10.0.0.0', 8, 'ipv4'); // private-use
  blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // shared address space (CGNAT)
  blockList.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
  blockList.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. cloud metadata endpoints)
  blockList.addSubnet('172.16.0.0', 12, 'ipv4'); // private-use
  blockList.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments (incl. DS-Lite, NAT64/DNS64 discovery sub-ranges)
  blockList.addSubnet('192.0.2.0', 24, 'ipv4'); // documentation (TEST-NET-1)
  blockList.addSubnet('192.31.196.0', 24, 'ipv4'); // AS112-v4 (RFC 7535)
  blockList.addSubnet('192.52.193.0', 24, 'ipv4'); // AMT (RFC 7450)
  blockList.addSubnet('192.88.99.0', 24, 'ipv4'); // 6to4 relay anycast (deprecated)
  blockList.addSubnet('192.168.0.0', 16, 'ipv4'); // private-use
  blockList.addSubnet('192.175.48.0', 24, 'ipv4'); // direct delegation AS112 service (RFC 7534)
  blockList.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
  blockList.addSubnet('198.51.100.0', 24, 'ipv4'); // documentation (TEST-NET-2)
  blockList.addSubnet('203.0.113.0', 24, 'ipv4'); // documentation (TEST-NET-3)
  blockList.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
  blockList.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved for future use (includes 255.255.255.255 broadcast)

  // IPv6 — IANA IPv6 Special-Purpose Address Registry.
  blockList.addSubnet('::', 128, 'ipv6'); // unspecified address
  blockList.addSubnet('::1', 128, 'ipv6'); // loopback
  blockList.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64 (RFC 6052; may itself embed a public IPv4 — refused anyway, defense-in-depth: no legitimate use for this project)
  blockList.addSubnet('64:ff9b:1::', 48, 'ipv6'); // NAT64, local use (RFC 8215)
  blockList.addSubnet('100::', 64, 'ipv6'); // discard-only address block
  // 2001::/23 is "IETF Protocol Assignments" (RFC 2928); the sub-ranges
  // below are the specific special-purpose allocations within it that
  // are actually reachable/anycast-style ranges, not merely reserved —
  // each one individually IANA-registered:
  blockList.addSubnet('2001::', 32, 'ipv6'); // Teredo (RFC 4380, RFC 8190)
  blockList.addSubnet('2001:1::1', 128, 'ipv6'); // Port Control Protocol anycast (RFC 7723)
  blockList.addSubnet('2001:1::2', 128, 'ipv6'); // Traversal Using Relays around NAT (TURN) anycast (RFC 8155)
  blockList.addSubnet('2001:2::', 48, 'ipv6'); // benchmarking (RFC 5180)
  blockList.addSubnet('2001:3::', 32, 'ipv6'); // AMT (RFC 7450)
  blockList.addSubnet('2001:4:112::', 48, 'ipv6'); // AS112-v6 (RFC 7535)
  blockList.addSubnet('2001:10::', 28, 'ipv6'); // deprecated ORCHID (RFC 4843) — reclaimed but still IANA-listed; no legitimate destination
  blockList.addSubnet('2001:20::', 28, 'ipv6'); // ORCHIDv2 (RFC 7343)
  blockList.addSubnet('2001:30::', 28, 'ipv6'); // Drone Remote ID Protocol Entity Tags (RFC 9374)
  blockList.addSubnet('2001:db8::', 32, 'ipv6'); // documentation (RFC 3849)
  blockList.addSubnet('2002::', 16, 'ipv6'); // 6to4 (RFC 3056)
  blockList.addSubnet('2620:4f:8000::', 48, 'ipv6'); // direct delegation AS112 service (RFC 7534)
  blockList.addSubnet('3fff::', 20, 'ipv6'); // documentation (RFC 9637)
  blockList.addSubnet('5f00::', 16, 'ipv6'); // segment routing (SRv6) SIDs (RFC 9602)
  blockList.addSubnet('fc00::', 7, 'ipv6'); // unique local addresses
  blockList.addSubnet('fe80::', 10, 'ipv6'); // link-local
  blockList.addSubnet('ff00::', 8, 'ipv6'); // multicast

  return blockList;
}

const DISALLOWED_IP_BLOCK_LIST = buildDisallowedIpBlockList();

/**
 * True for any address — IPv4, IPv6, or an IPv4-mapped IPv6 address in
 * either representation — that falls in one of the special-use ranges
 * `buildDisallowedIpBlockList` registers. A value that isn't even a
 * syntactically valid IP literal (per `net.isIP`) is treated as
 * disallowed too — fail closed, never guessed at.
 */
function isDisallowedIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return true;
  const version = net.isIP(ip);
  if (version === 0) return true;
  return DISALLOWED_IP_BLOCK_LIST.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

/** Convenience wrapper — disallowed unless `ip` is specifically a valid
 * IPv4 literal that also fails the block-list check. */
function isDisallowedIPv4(ip) {
  if (typeof ip !== 'string' || net.isIP(ip) !== 4) return true;
  return DISALLOWED_IP_BLOCK_LIST.check(ip, 'ipv4');
}

/** Convenience wrapper — disallowed unless `ip` is specifically a valid
 * IPv6 literal (dotted-decimal-embedded or hex-embedded IPv4-mapped
 * forms both count) that also fails the block-list check. */
function isDisallowedIPv6(ip) {
  if (typeof ip !== 'string' || net.isIP(ip) !== 6) return true;
  return DISALLOWED_IP_BLOCK_LIST.check(ip, 'ipv6');
}

/**
 * Strips the `[...]` brackets WHATWG `URL.prototype.hostname` always
 * wraps an IPv6 literal in (confirmed directly against this Node
 * runtime) — `net.isIP()`/`BlockList.check()` both expect a bare
 * address, not the bracketed form.
 */
function stripHostnameBrackets(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Shape-only checks — protocol, no embedded credentials, the
 * well-known `localhost` loopback alias, and, critically, **a literal
 * IPv4 or IPv6 host address checked directly, right here, before any
 * request is ever issued.** This last check is not redundant with the
 * guarded `lookup` function below: Node's `http(s).request()` does
 * **not** invoke a custom `lookup` option at all when the target host
 * is already a literal IP address (no DNS resolution is needed) —
 * confirmed directly against this Node runtime — so `isSafeUrlShape`
 * is the *only* enforcement point for a literal-IP target. The guarded
 * lookup remains the enforcement point for an actual hostname that
 * genuinely needs DNS resolution (including one that resolves to a
 * disallowed address only later, e.g. via DNS rebinding).
 */
function isSafeUrlShape(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;

  const literalHost = stripHostnameBrackets(hostname);
  if (net.isIP(literalHost) !== 0 && isDisallowedIp(literalHost)) return false;

  return true;
}

// ─── Guarded DNS lookup ──────────────────────────────────────────────────

/**
 * Returns a function with the same signature Node's `http(s).request()`
 * expects for its `lookup` option: `(hostname, options, callback)`.
 * Resolves via `resolveImpl` (defaults to the real `dns.lookup`,
 * injectable for tests) and calls back with an error — never a resolved
 * address — whenever *every* candidate result is disallowed by
 * `isDisallowedIp`. Node never opens a socket when `lookup` errors.
 *
 * **Must handle `options.all === true`.** Node's http(s) client enables
 * "Happy Eyeballs" (`autoSelectFamily`) by default and, confirmed
 * directly against this Node runtime, always calls a *custom* `lookup`
 * with `{ all: true, ... }` — meaning the callback must reply with an
 * **array** of `{ address, family }` results (`dns.lookup`'s own
 * documented contract for `{ all: true }`), never the single
 * `(err, address, family)` triple. The first version of this function
 * always replied in the single-value form regardless of what was
 * requested, which Node's http client rejected outright with "Invalid
 * IP address: undefined" — found and fixed the same day as the literal-IP
 * SSRF gap above. When `all` is requested, every disallowed candidate is
 * filtered out of the array (not just the first) — Node itself then
 * tries each *allowed* candidate in turn; if none remain, this call
 * fails, and no socket is ever opened to a disallowed address either
 * way.
 */
function createGuardedLookup(resolveImpl = dns.lookup) {
  return function guardedLookup(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options || {};
    resolveImpl(hostname, opts, (err, address, family) => {
      if (err) {
        cb(err);
        return;
      }
      if (opts.all) {
        const candidates = Array.isArray(address) ? address : [];
        const allowed = candidates.filter((entry) => entry && !isDisallowedIp(entry.address));
        if (allowed.length === 0) {
          const seen = candidates.map((entry) => entry && entry.address).join(', ') || '(none)';
          cb(new SafeFetchError('resolved-address-not-allowed', `No allowed address among resolved candidates: ${seen}`));
          return;
        }
        cb(null, allowed);
        return;
      }
      if (isDisallowedIp(address)) {
        cb(new SafeFetchError('resolved-address-not-allowed', `Resolved address is not allowed: ${address}`));
        return;
      }
      cb(null, address, family);
    });
  };
}

// ─── The guarded fetch itself ────────────────────────────────────────────

function parseContentType(headerValue) {
  if (!headerValue) return null;
  return headerValue.split(';')[0].trim().toLowerCase();
}

/**
 * Fetches `targetUrl` with every defense described in this file's own
 * header comment. Resolves `{ body, finalUrl, contentType, redirected }`
 * on success (a real `200` response, within all limits). Rejects with a
 * `SafeFetchError` (see `.reason`) on any violation — never partially
 * resolves with an untrusted/incomplete body.
 */
function fetchWebsiteSafely(targetUrl, options = {}) {
  const {
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // Defaults to the real guard (real DNS + isDisallowedIp) — a caller
    // must go out of its way to override this, and no route in this
    // project ever does. Tests use this seam to inject either (a) a
    // guarded lookup backed by a fake resolveImpl, to prove the SSRF
    // guard itself integrates correctly with no real network access, or
    // (b) an unguarded passthrough lookup, to exercise every *other*
    // behavior (redirects/size cap/timeout) against a real local test
    // server without tripping the (correct, intentional) loopback
    // rejection that a real local server would otherwise always hit.
    lookup = createGuardedLookup(),
    requestImplHttp = http.request,
    requestImplHttps = https.request,
  } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    function issueRequest(url, redirectsLeft, isFollowingRedirect) {
      if (!isSafeUrlShape(url)) {
        fail(new SafeFetchError('unsafe-url-shape', `Refusing to fetch (unsafe URL shape): ${url.href}`));
        return;
      }

      const requestImpl = url.protocol === 'https:' ? requestImplHttps : requestImplHttp;
      let bytesWritten = 0;
      let chunks = [];

      const req = requestImpl(
        url.href,
        {
          lookup,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectsLeft <= 0) {
              res.resume();
              fail(new SafeFetchError('too-many-redirects', 'Exceeded the maximum number of allowed redirects'));
              return;
            }
            // The redirect response's own body/content-type is never
            // read as the page — drained and discarded, unused.
            res.resume();
            let nextUrl;
            try {
              nextUrl = new URL(res.headers.location, url);
            } catch (err) {
              fail(new SafeFetchError('redirect-location-invalid', String(res.headers.location)));
              return;
            }
            issueRequest(nextUrl, redirectsLeft - 1, true);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume();
            fail(new SafeFetchError('bad-status', `Expected HTTP 200, got ${res.statusCode}`));
            return;
          }

          const contentType = parseContentType(res.headers['content-type']);

          res.on('data', (chunk) => {
            if (settled) return;
            bytesWritten += chunk.length;
            if (bytesWritten > maxBytes) {
              res.destroy();
              fail(new SafeFetchError('response-too-large', `Response exceeded maxBytes=${maxBytes}`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (settled) return;
            succeed({
              body: Buffer.concat(chunks).toString('utf8'),
              finalUrl: url.href,
              contentType,
              redirected: isFollowingRedirect,
            });
          });
          res.on('error', (err) => {
            fail(new SafeFetchError('response-error', err.message));
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new SafeFetchError('timeout', `Request timed out after ${timeoutMs}ms`));
      });
      req.on('error', (err) => {
        if (err instanceof SafeFetchError) {
          fail(err);
        } else {
          fail(new SafeFetchError('request-error', err.message));
        }
      });
      req.end();
    }

    let initialUrl;
    try {
      initialUrl = new URL(targetUrl);
    } catch (err) {
      fail(new SafeFetchError('invalid-url', String(targetUrl)));
      return;
    }
    issueRequest(initialUrl, maxRedirects, false);
  });
}

module.exports = {
  SafeFetchError,
  isDisallowedIp,
  isDisallowedIPv4,
  isDisallowedIPv6,
  stripHostnameBrackets,
  isSafeUrlShape,
  createGuardedLookup,
  fetchWebsiteSafely,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
};
