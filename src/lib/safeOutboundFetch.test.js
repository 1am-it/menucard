'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  SafeFetchError,
  isDisallowedIp,
  isDisallowedIPv4,
  isDisallowedIPv6,
  stripHostnameBrackets,
  isSafeUrlShape,
  createGuardedLookup,
  fetchWebsiteSafely,
} = require('./safeOutboundFetch');

// ─── isDisallowedIPv4 / isDisallowedIPv6 / isDisallowedIp ───────────────
// Built on Node's own net.BlockList — see safeOutboundFetch.js's own
// header comment. These tests exercise the full IANA special-purpose
// range list this project registers, not just the handful most SSRF
// writeups mention.

test('isDisallowedIPv4: loopback, private, link-local, "this network," shared/CGNAT, documentation/benchmarking, and multicast/reserved ranges are all disallowed', () => {
  const disallowed = [
    '127.0.0.1', '127.1.2.3', // loopback
    '10.0.0.1', '10.255.255.255', // private
    '172.16.0.1', '172.31.255.255', // private
    '192.168.0.1', '192.168.255.255', // private
    '169.254.1.1', '169.254.169.254', // link-local (incl. cloud metadata)
    '0.0.0.0', '0.1.2.3', // "this network"
    '100.64.0.1', '100.127.255.255', // shared address space / CGNAT
    '192.0.0.1', // IETF protocol assignments
    '192.0.2.1', // documentation (TEST-NET-1)
    '192.88.99.1', // 6to4 relay anycast
    '198.18.0.1', '198.19.255.255', // benchmarking
    '198.51.100.1', // documentation (TEST-NET-2)
    '203.0.113.1', // documentation (TEST-NET-3)
    '224.0.0.1', // multicast
    '240.0.0.1', '255.255.255.255', // reserved / broadcast
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIPv4(ip), true, `expected ${ip} to be disallowed`);
  }
});

test('isDisallowedIPv4: ordinary public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.0']) {
    assert.equal(isDisallowedIPv4(ip), false, `expected ${ip} to be allowed`);
  }
});

// Correction (2026-09-12): AS112-v4, AMT, and the direct-delegation
// AS112 service range were missing from the IANA IPv4 registry coverage
// entirely — these three ranges are technically globally routable
// (unlike RFC 1918 private space), which is exactly why they must be
// explicitly disallowed rather than assumed to fall out of some other
// check.
test('isDisallowedIPv4: AS112-v4, AMT, and direct-delegation AS112 ranges (newly added) are disallowed', () => {
  const disallowed = [
    '192.31.196.1', '192.31.196.255', // AS112-v4 (RFC 7535)
    '192.52.193.1', '192.52.193.255', // AMT (RFC 7450)
    '192.175.48.1', '192.175.48.255', // direct delegation AS112 service (RFC 7534)
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIPv4(ip), true, `expected ${ip} to be disallowed`);
  }
});

test('isDisallowedIPv4: addresses immediately outside the new AS112/AMT ranges are still allowed (no over-blocking)', () => {
  for (const ip of ['192.31.195.255', '192.31.197.0', '192.52.192.255', '192.52.194.0', '192.175.47.255', '192.175.49.0']) {
    assert.equal(isDisallowedIPv4(ip), false, `expected ${ip} to be allowed`);
  }
});

test('isDisallowedIPv4: malformed input fails closed (disallowed), never guessed at', () => {
  for (const bad of ['not-an-ip', '1.2.3', '1.2.3.4.5', '999.1.1.1', '', null, undefined, '::1']) {
    assert.equal(isDisallowedIPv4(bad), true, `expected ${JSON.stringify(bad)} to be disallowed`);
  }
});

test('isDisallowedIPv6: loopback, unspecified, link-local, unique-local, documentation, discard-only, and multicast ranges are disallowed', () => {
  const disallowed = [
    '::1', // loopback
    '::', // unspecified
    'fe80::1', 'fe80:0000:0000:0000:0202:b3ff:fe1e:8329', // link-local
    'fc00::1', 'fd12:3456:789a::1', // unique local
    '2001:db8::1', // documentation
    '100::1', // discard-only
    '64:ff9b::1', // NAT64
    'ff02::1', // multicast
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIPv6(ip), true, `expected ${ip} to be disallowed`);
  }
});

test('isDisallowedIPv6: an IPv4-mapped address is checked against the embedded IPv4 rules, in BOTH dotted-decimal and hex form', () => {
  assert.equal(isDisallowedIPv6('::ffff:127.0.0.1'), true, 'dotted-decimal form, loopback');
  assert.equal(isDisallowedIPv6('::ffff:7f00:1'), true, 'hex form (Node\'s own canonical form), loopback — the exact case named in this fix');
  assert.equal(isDisallowedIPv6('::ffff:a00:1'), true, 'hex form, 10.0.0.1 (private)');
  assert.equal(isDisallowedIPv6('::ffff:8.8.8.8'), false, 'dotted-decimal form, public');
  assert.equal(isDisallowedIPv6('::ffff:808:808'), false, 'hex form, public (8.8.8.8)');
});

test('isDisallowedIPv6: an ordinary public IPv6 address is allowed', () => {
  assert.equal(isDisallowedIPv6('2001:4860:4860::8888'), false);
});

// Correction (2026-09-12): most of the IETF-protocol-assignment
// sub-ranges within 2001::/23, plus the second NAT64 range, 6to4, the
// second AS112 direct-delegation range, and the newer SRv6/documentation
// ranges were missing from the IANA IPv6 registry coverage entirely.
test('isDisallowedIPv6: the newly added 2001::/23 sub-ranges (Teredo, PCP/TURN anycast, benchmarking, AMT, AS112-v6, ORCHID/ORCHIDv2, Drone Remote ID) are disallowed', () => {
  const disallowed = [
    '2001::1', '2001::ffff', // Teredo (RFC 4380)
    '2001:1::1', // Port Control Protocol anycast (RFC 7723)
    '2001:1::2', // TURN anycast (RFC 8155)
    '2001:2::1', // benchmarking (RFC 5180)
    '2001:3::1', // AMT (RFC 7450)
    '2001:4:112::1', // AS112-v6 (RFC 7535)
    '2001:10::1', // deprecated ORCHID (RFC 4843)
    '2001:20::1', // ORCHIDv2 (RFC 7343)
    '2001:30::1', // Drone Remote ID Protocol Entity Tags (RFC 9374)
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIPv6(ip), true, `expected ${ip} to be disallowed`);
  }
});

test('isDisallowedIPv6: a public address elsewhere inside the broader 2001::/23 IETF-assignment block is still allowed (no over-blocking of the whole /23)', () => {
  assert.equal(isDisallowedIPv6('2001:4860:4860::8888'), false, 'Google public DNS falls inside 2001::/23 but outside every specific disallowed sub-range');
});

test('isDisallowedIPv6: the newly added transition/anycast/documentation ranges (NAT64 local-use, 6to4, AS112 direct delegation, documentation, SRv6) are disallowed', () => {
  const disallowed = [
    '64:ff9b:1::1', // NAT64, local use (RFC 8215)
    '2002::1', // 6to4 (RFC 3056)
    '2620:4f:8000::1', // direct delegation AS112 service (RFC 7534)
    '3fff::1', // documentation (RFC 9637)
    '5f00::1', // segment routing (SRv6) SIDs (RFC 9602)
  ];
  for (const ip of disallowed) {
    assert.equal(isDisallowedIPv6(ip), true, `expected ${ip} to be disallowed`);
  }
});

test('isDisallowedIPv6: malformed input fails closed (disallowed), never guessed at', () => {
  for (const bad of ['not-an-ip', '', null, undefined, '127.0.0.1', 'gggg::1']) {
    assert.equal(isDisallowedIPv6(bad), true, `expected ${JSON.stringify(bad)} to be disallowed`);
  }
});

test('isDisallowedIp: dispatches by address family and fails closed on anything unparseable', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('::ffff:7f00:1'), true);
  assert.equal(isDisallowedIp('8.8.8.8'), false);
  assert.equal(isDisallowedIp('2001:4860:4860::8888'), false);
  assert.equal(isDisallowedIp(''), true);
  assert.equal(isDisallowedIp(null), true);
  assert.equal(isDisallowedIp(undefined), true);
  assert.equal(isDisallowedIp('not-an-ip-at-all'), true);
});

// ─── stripHostnameBrackets ───────────────────────────────────────────────

test('stripHostnameBrackets: removes brackets from an IPv6 hostname, leaves everything else untouched', () => {
  assert.equal(stripHostnameBrackets('[::1]'), '::1');
  assert.equal(stripHostnameBrackets('[::ffff:7f00:1]'), '::ffff:7f00:1');
  assert.equal(stripHostnameBrackets('example.com'), 'example.com');
  assert.equal(stripHostnameBrackets('127.0.0.1'), '127.0.0.1');
});

// ─── isSafeUrlShape ──────────────────────────────────────────────────────

test('isSafeUrlShape: only http/https protocols are allowed', () => {
  assert.equal(isSafeUrlShape(new URL('https://example.com')), true);
  assert.equal(isSafeUrlShape(new URL('http://example.com')), true);
  assert.equal(isSafeUrlShape(new URL('ftp://example.com')), false);
  assert.equal(isSafeUrlShape(new URL('file:///etc/passwd')), false);
});

test('isSafeUrlShape: rejects embedded credentials', () => {
  assert.equal(isSafeUrlShape(new URL('https://user:pass@example.com')), false);
});

test('isSafeUrlShape: rejects the literal "localhost" alias and its subdomains, before any DNS lookup', () => {
  assert.equal(isSafeUrlShape(new URL('http://localhost')), false);
  assert.equal(isSafeUrlShape(new URL('http://LOCALHOST')), false);
  assert.equal(isSafeUrlShape(new URL('http://foo.localhost')), false);
});

test('isSafeUrlShape: an ordinary public https URL (a real hostname needing DNS resolution) is allowed', () => {
  assert.equal(isSafeUrlShape(new URL('https://restaurant.example/contact')), true);
});

// ─── isSafeUrlShape: literal IP hosts — the specific gap this fix closes.
// Node's http(s).request() does not invoke a custom `lookup` at all when
// the host is already a literal IP, so this check is the ONLY
// enforcement point for these — proven here with no request ever issued
// (these are synchronous, pure calls against a parsed URL object). ──────

test('isSafeUrlShape: rejects a literal IPv4 loopback/private/link-local host outright', () => {
  for (const host of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1']) {
    assert.equal(isSafeUrlShape(new URL(`http://${host}/`)), false, `expected http://${host}/ to be rejected`);
  }
});

test('isSafeUrlShape: rejects a literal IPv6 loopback host, bracketed as a real URL always requires', () => {
  assert.equal(isSafeUrlShape(new URL('http://[::1]/')), false);
  assert.equal(isSafeUrlShape(new URL('http://[fe80::1]/')), false);
  assert.equal(isSafeUrlShape(new URL('http://[fc00::1]/')), false);
});

test('isSafeUrlShape: rejects an IPv4-mapped IPv6 literal host — in both dotted-decimal and Node\'s own canonical hex form', () => {
  // new URL() itself always canonicalizes an IPv4-mapped IPv6 literal to
  // the hex form (::ffff:7f00:1) — confirmed directly against this Node
  // runtime — so both inputs below exercise the exact same real code
  // path a browser/curl-style URL would.
  assert.equal(isSafeUrlShape(new URL('http://[::ffff:127.0.0.1]/')), false, 'dotted-decimal input');
  assert.equal(isSafeUrlShape(new URL('http://[::ffff:7f00:1]/')), false, 'hex input, same address');
});

test('isSafeUrlShape: a literal, genuinely public IP host is still allowed', () => {
  assert.equal(isSafeUrlShape(new URL('http://8.8.8.8/')), true);
  assert.equal(isSafeUrlShape(new URL('http://[2001:4860:4860::8888]/')), true);
});

// ─── createGuardedLookup ─────────────────────────────────────────────────

test('createGuardedLookup: calls back with an error, never an address, when the resolved IP is disallowed', () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '127.0.0.1', 4);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('evil.example', {}, (err, address) => {
    assert.ok(err instanceof Error);
    assert.equal(err.reason, 'resolved-address-not-allowed');
    assert.equal(address, undefined);
  });
});

test('createGuardedLookup: calls back normally with the address when it is allowed', () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '93.184.216.34', 4);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('restaurant.example', {}, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  });
});

test('createGuardedLookup: supports the (hostname, callback) call shape (no options object), same as Node\'s own dns.lookup', () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '8.8.8.8', 4);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('example.com', (err, address) => {
    assert.equal(err, null);
    assert.equal(address, '8.8.8.8');
  });
});

test('createGuardedLookup: propagates a genuine resolver error (e.g. NXDOMAIN) unchanged', () => {
  const dnsError = new Error('getaddrinfo ENOTFOUND');
  const fakeResolve = (hostname, options, cb) => cb(dnsError);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('nonexistent.example', {}, (err) => {
    assert.equal(err, dnsError);
  });
});

// ─── createGuardedLookup: the { all: true } shape — the specific bug
// this fix closes. Node's http(s) client enables "Happy Eyeballs" by
// default and always calls a custom `lookup` with `{ all: true, ... }`,
// requiring the callback to reply with an array — the very first
// version of createGuardedLookup always replied in the single-address
// form regardless, which Node's own http client rejected outright. ────

test('createGuardedLookup: with { all: true }, replies with an array — never the single (err, address, family) triple', () => {
  const fakeResolve = (hostname, options, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('restaurant.example', { all: true }, (err, result) => {
    assert.equal(err, null);
    assert.deepEqual(result, [{ address: '93.184.216.34', family: 4 }]);
  });
});

test('createGuardedLookup: with { all: true }, filters out disallowed candidates but keeps allowed ones', () => {
  const fakeResolve = (hostname, options, cb) =>
    cb(null, [
      { address: '127.0.0.1', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('mixed.example', { all: true }, (err, result) => {
    assert.equal(err, null);
    assert.deepEqual(result, [{ address: '93.184.216.34', family: 4 }]);
  });
});

test('createGuardedLookup: with { all: true }, errors when every candidate is disallowed — never opens a socket to any of them', () => {
  const fakeResolve = (hostname, options, cb) =>
    cb(null, [
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
  const guarded = createGuardedLookup(fakeResolve);
  guarded('all-bad.example', { all: true }, (err, result) => {
    assert.ok(err instanceof Error);
    assert.equal(err.reason, 'resolved-address-not-allowed');
    assert.equal(result, undefined);
  });
});

// ─── fetchWebsiteSafely: literal-IP rejection — proven with no request
// ever issued at all, via a requestImpl spy that fails the test if
// called. This is the direct, end-to-end proof that a literal-IP target
// never reaches http(s).request() in the first place. ───────────────────

function requestImplThatMustNeverBeCalled() {
  return () => {
    throw new Error('a request must never be issued for a disallowed literal-IP target');
  };
}

test('fetchWebsiteSafely: a literal IPv4 loopback target is rejected with no request ever issued', async () => {
  await assert.rejects(
    () =>
      fetchWebsiteSafely('http://127.0.0.1/secret', {
        requestImplHttp: requestImplThatMustNeverBeCalled(),
        requestImplHttps: requestImplThatMustNeverBeCalled(),
      }),
    (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape'
  );
});

test('fetchWebsiteSafely: a literal IPv6 loopback target ([::1]) is rejected with no request ever issued', async () => {
  await assert.rejects(
    () =>
      fetchWebsiteSafely('http://[::1]/secret', {
        requestImplHttp: requestImplThatMustNeverBeCalled(),
        requestImplHttps: requestImplThatMustNeverBeCalled(),
      }),
    (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape'
  );
});

test('fetchWebsiteSafely: an IPv4-mapped IPv6 literal target (dotted or hex form) is rejected with no request ever issued', async () => {
  for (const target of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/']) {
    await assert.rejects(
      () =>
        fetchWebsiteSafely(target, {
          requestImplHttp: requestImplThatMustNeverBeCalled(),
          requestImplHttps: requestImplThatMustNeverBeCalled(),
        }),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape',
      `expected ${target} to be rejected`
    );
  }
});

test('fetchWebsiteSafely: other special-use literal IPv4 targets (private/link-local/CGNAT) are all rejected with no request issued', async () => {
  for (const host of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1']) {
    await assert.rejects(
      () =>
        fetchWebsiteSafely(`http://${host}/`, {
          requestImplHttp: requestImplThatMustNeverBeCalled(),
          requestImplHttps: requestImplThatMustNeverBeCalled(),
        }),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape',
      `expected ${host} to be rejected`
    );
  }
});

// Correction (2026-09-12): end-to-end proof, at the fetchWebsiteSafely
// level, that the newly added IANA ranges are enforced the same way as
// every other disallowed range — no request/socket is ever opened for
// them either, as a literal IPv4 or bracketed literal IPv6 host.
test('fetchWebsiteSafely: newly added special-purpose literal IPv4 targets (AS112-v4, AMT, direct-delegation AS112) are rejected with no request issued', async () => {
  for (const host of ['192.31.196.1', '192.52.193.1', '192.175.48.1']) {
    await assert.rejects(
      () =>
        fetchWebsiteSafely(`http://${host}/`, {
          requestImplHttp: requestImplThatMustNeverBeCalled(),
          requestImplHttps: requestImplThatMustNeverBeCalled(),
        }),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape',
      `expected ${host} to be rejected`
    );
  }
});

test('fetchWebsiteSafely: newly added special-purpose literal IPv6 targets (Teredo, AMT, AS112-v6, 6to4, SRv6, documentation) are rejected with no request issued', async () => {
  for (const host of ['[2001::1]', '[2001:3::1]', '[2001:4:112::1]', '[2002::1]', '[5f00::1]', '[3fff::1]']) {
    await assert.rejects(
      () =>
        fetchWebsiteSafely(`http://${host}/`, {
          requestImplHttp: requestImplThatMustNeverBeCalled(),
          requestImplHttps: requestImplThatMustNeverBeCalled(),
        }),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape',
      `expected ${host} to be rejected`
    );
  }
});

// ─── fetchWebsiteSafely: SSRF guard integration for real *hostnames* —
// no real network needed, since a disallowed resolved address must
// never even open a socket ────────────────────────────────────────────

test('fetchWebsiteSafely: rejects when the guarded lookup resolves a hostname to a private/loopback address — never connects', async () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '127.0.0.1', 4);
  await assert.rejects(
    () =>
      fetchWebsiteSafely('http://looks-public-but-isnt.example/', {
        lookup: createGuardedLookup(fakeResolve),
      }),
    (err) => err instanceof SafeFetchError && err.reason === 'resolved-address-not-allowed'
  );
});

test('fetchWebsiteSafely: rejects a link-local resolved address the same way', async () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '169.254.1.1', 4);
  await assert.rejects(
    () => fetchWebsiteSafely('http://internal-metadata.example/', { lookup: createGuardedLookup(fakeResolve) }),
    (err) => err instanceof SafeFetchError && err.reason === 'resolved-address-not-allowed'
  );
});

// Correction (2026-09-12): a hostname resolving (e.g. via DNS rebinding)
// to one of the newly added special-purpose ranges must be rejected by
// the guarded lookup exactly like any other disallowed resolved
// address — proven here for one newly added IPv4 range and one newly
// added IPv6 range.
test('fetchWebsiteSafely: rejects a resolved address in a newly added IPv4 special-purpose range (AS112-v4) the same way', async () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '192.31.196.5', 4);
  await assert.rejects(
    () => fetchWebsiteSafely('http://rebinding-target.example/', { lookup: createGuardedLookup(fakeResolve) }),
    (err) => err instanceof SafeFetchError && err.reason === 'resolved-address-not-allowed'
  );
});

test('fetchWebsiteSafely: rejects a resolved address in a newly added IPv6 special-purpose range (6to4) the same way', async () => {
  const fakeResolve = (hostname, options, cb) => cb(null, '2002::1', 6);
  await assert.rejects(
    () => fetchWebsiteSafely('http://rebinding-target.example/', { lookup: createGuardedLookup(fakeResolve) }),
    (err) => err instanceof SafeFetchError && err.reason === 'resolved-address-not-allowed'
  );
});

test('fetchWebsiteSafely: rejects before any lookup for an unsafe URL shape (non-http(s), credentials, localhost)', async () => {
  for (const badUrl of ['ftp://example.com/', 'http://user:pass@example.com/', 'http://localhost/']) {
    await assert.rejects(
      () => fetchWebsiteSafely(badUrl, {}),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape',
      `expected ${badUrl} to be rejected on shape alone`
    );
  }
});

test('fetchWebsiteSafely: an invalid URL string is rejected cleanly, never throws synchronously', async () => {
  await assert.rejects(
    () => fetchWebsiteSafely('not a url at all', {}),
    (err) => err instanceof SafeFetchError && err.reason === 'invalid-url'
  );
});

// ─── fetchWebsiteSafely: real local HTTP server, reached via a *hostname*
// (never a literal IP in the request URL, since a literal IP is now
// always rejected by isSafeUrlShape regardless of any lookup override —
// exactly the behavior under test above) resolved by an UNGUARDED
// test-only lookup to 127.0.0.1. This exercises every *other* behavior
// (200 handling, redirects, size cap, headers) against a genuine server
// and the genuine Node http client — mirroring
// ops/scripts/import-breda-osm.test.js's own real-local-server
// convention. ──────────────────────────────────────────────────────────

function passthroughLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options || {};
  // Node's http(s) client requests { all: true } by default (Happy
  // Eyeballs) — the callback must then reply with an array of
  // { address, family }, never the single (err, address, family) triple.
  if (opts.all) {
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  } else {
    cb(null, '127.0.0.1', 4);
  }
}

const TEST_HOSTNAME = 'fixture-server.test.internal';

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test('fetchWebsiteSafely: a direct 200 response is returned with its body and content type', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body>hello</body></html>');
  });
  try {
    const { port } = server.address();
    const result = await fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup });
    assert.equal(result.body, '<html><body>hello</body></html>');
    assert.equal(result.contentType, 'text/html');
    assert.equal(result.redirected, false);
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: follows one redirect and re-validates the target the same way', async () => {
  const server = await startTestServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(302, { Location: `/contact` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>contact page</html>');
  });
  try {
    const { port } = server.address();
    const result = await fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup });
    assert.equal(result.body, '<html>contact page</html>');
    assert.equal(result.redirected, true);
    assert.match(result.finalUrl, /\/contact$/);
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: a redirect to a hostname that resolves to a disallowed address is rejected mid-chain', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: 'http://internal.example/secret' });
    res.end();
  });
  try {
    const { port } = server.address();
    let sawRedirectTargetLookup = false;
    const mixedLookup = (hostname, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const opts = typeof options === 'function' ? {} : options || {};
      if (hostname === TEST_HOSTNAME) {
        if (opts.all) {
          cb(null, [{ address: '127.0.0.1', family: 4 }]);
        } else {
          cb(null, '127.0.0.1', 4);
        }
        return;
      }
      sawRedirectTargetLookup = true;
      cb(new SafeFetchError('resolved-address-not-allowed', 'blocked'));
    };
    await assert.rejects(
      () => fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: mixedLookup }),
      (err) => err instanceof SafeFetchError
    );
    assert.equal(sawRedirectTargetLookup, true, 'expected the redirect target to trigger its own, independent lookup');
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: a redirect to a literal, disallowed IP address is rejected mid-chain, with no request ever issued to it', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/secret' });
    res.end();
  });
  try {
    const { port } = server.address();
    // A requestImpl wrapper that allows exactly the first (legitimate)
    // hop through to the real Node http.request, but throws if a second
    // request is ever attempted — proving the redirect target is never
    // actually connected to, regardless of what port/path it names.
    let requestCount = 0;
    const guardedRequestImplHttp = (...args) => {
      requestCount += 1;
      if (requestCount > 1) {
        throw new Error('a second request must never be issued for a literal-IP redirect target');
      }
      return http.request(...args);
    };
    await assert.rejects(
      () =>
        fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, {
          lookup: passthroughLookup,
          requestImplHttp: guardedRequestImplHttp,
        }),
      (err) => err instanceof SafeFetchError && err.reason === 'unsafe-url-shape'
    );
    assert.equal(requestCount, 1, 'only the first, legitimate hop may ever reach a real request');
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: exceeding maxRedirects is rejected, never followed indefinitely', async () => {
  const server = await startTestServer((req, res) => {
    const n = Number(req.url.slice(1)) || 0;
    res.writeHead(302, { Location: `/${n + 1}` });
    res.end();
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/0`, { lookup: passthroughLookup, maxRedirects: 2 }),
      (err) => err instanceof SafeFetchError && err.reason === 'too-many-redirects'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: maxRedirects: 0 rejects even a single redirect — the "disable redirects entirely" mode used by the website-suggestions route', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(302, { Location: '/elsewhere' });
    res.end();
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup, maxRedirects: 0 }),
      (err) => err instanceof SafeFetchError && err.reason === 'too-many-redirects'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: a response exceeding maxBytes is aborted, never buffered in full', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(Buffer.alloc(2000, 'a'));
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup, maxBytes: 100 }),
      (err) => err instanceof SafeFetchError && err.reason === 'response-too-large'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: a non-200 final status is rejected', async () => {
  const server = await startTestServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('not found');
  });
  try {
    const { port } = server.address();
    await assert.rejects(
      () => fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup }),
      (err) => err instanceof SafeFetchError && err.reason === 'bad-status'
    );
  } finally {
    await stopTestServer(server);
  }
});

test('fetchWebsiteSafely: never sends a Cookie or Authorization header', async () => {
  let sawForbiddenHeader = false;
  const server = await startTestServer((req, res) => {
    if (req.headers.cookie || req.headers.authorization) sawForbiddenHeader = true;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('ok');
  });
  try {
    const { port } = server.address();
    await fetchWebsiteSafely(`http://${TEST_HOSTNAME}:${port}/`, { lookup: passthroughLookup });
    assert.equal(sawForbiddenHeader, false);
  } finally {
    await stopTestServer(server);
  }
});
