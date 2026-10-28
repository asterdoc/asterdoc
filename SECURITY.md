# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Asterdoc, please **do not** open a public GitHub issue. Instead, report it privately to [hello@asterdoc.com](mailto:hello@asterdoc.com) or through [asterdoc.com/contact](https://asterdoc.com/contact), with details of the vulnerability.

### What to Include in Your Report

Please include:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (if you have them)

### Security Disclosure Timeline

We aim to:
1. Acknowledge receipt of your report within 48 hours
2. Provide an initial assessment within 5 days
3. Work toward a fix and release schedule
4. Coordinate disclosure of the vulnerability with you

## Security Best Practices

When using Asterdoc:

1. **Keep dependencies updated** - Regularly update npm packages using `pnpm update`
2. **Review changelogs** - Check release notes for security updates
3. **Follow npm security guidelines** - Ensure your `NPM_TOKEN` and credentials are never committed
4. **Report issues responsibly** - Use this security policy for vulnerability reports

## Supported Versions

Security updates are provided for:
- Latest major version (all minor/patch versions)
- Previous major version (critical fixes only)

## Security Features

Asterdoc includes:
- Full TypeScript type safety
- Input validation with AJV
- No hardcoded credentials or secrets
- ESM module security best practices
- Comprehensive test coverage

## Questions

For security-related questions, email [hello@asterdoc.com](mailto:hello@asterdoc.com) rather than using public issue trackers.

Thank you for helping keep Asterdoc secure!
