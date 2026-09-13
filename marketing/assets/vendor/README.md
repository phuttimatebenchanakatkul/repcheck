# Vendored third-party JavaScript

Committed here rather than loaded from a CDN, and that is not a preference.

`cookies.html` tells visitors this site makes no third-party requests and uses
that to justify having no consent banner, and
`tests/test_marketing_site_compliance.py::test_no_page_loads_anything_from_another_company`
fails on any off-site URL. Its own failure message spells out the fix: "Self-host
it, or update cookies.html and privacy.html and add a consent gate." A CDN tag
would also hand every visitor's IP to that CDN before consent, which is the
same problem the self-hosted fonts in `assets/fonts/` exist to avoid.

So: no `<script src="https://...">` on this site. Vendor it here instead.

## gsap 3.13.0

* `gsap.min.js` (72KB) and `ScrollTrigger.min.js` (44KB).
* Copied verbatim from the npm package `gsap@3.13.0`, files
  `dist/gsap.min.js` and `dist/ScrollTrigger.min.js`. Unmodified.
* Licence: GreenSock standard "no charge" licence,
  <https://gsap.com/standard-license>. GSAP is free for commercial use --
  core and every plugin -- since Webflow took it on.

To update: `npm install gsap@<version> --no-save`, re-copy those two files out
of `node_modules/gsap/dist/`, and re-run the marketing tests.
