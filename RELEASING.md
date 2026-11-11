# Publishing Hye Vem

## Documentation

The Documentation workflow builds and checks a static site at the domain root, then deploys main to GitHub Pages. The root opens `/docs/` with a static redirect and a link fallback, including without JavaScript.

Set repository Settings → Pages → Source to GitHub Actions, set the custom domain to `hyevem.com`, and enable HTTPS once DNS is verified. Configure the apex domain with an ALIAS/ANAME to `hyecompany.github.io`, or the GitHub Pages A records documented at https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site . No DNS or live settings are changed by this repository.

## Package releases

Release Please creates a release PR from Conventional Commits on main. The first release is configured as 1.0.0; the empty manifest means no version has yet been released. The current source version is updated by that PR. Review and merge the release PR to create the tag and automatically call the publish workflow. Subsequent releases follow semantic versioning. Publication checks the tagged source, builds and tests the packed package, and skips versions already on npm. A failed publication can be retried through Publish packages → Run workflow with the existing release tag.

Enable GitHub Actions to create pull requests. Configure npm trusted publishing for organization `hyecompany`, repository `vem-web`, workflow `publish.yml`. Check npm's current setup requirements for the first publication: https://docs.npmjs.com/trusted-publishers/ . Account authorization and the initial package registration are external prerequisites, not established by these files.

Commit examples (use the actual changes as the description):

- `feat(data): introduce shared browser knowledge runtime` — first release.
- `fix(data): preserve readable rows during acquisition` — patch.
- `feat(data): support a new read capability` — minor.
- `feat(data)!: change the resource definition contract` — major.
- `docs: improve the task board guide` — documentation only.
- `ci: configure documentation and package publishing` — infrastructure only.

The changed package paths determine which package releases; the scope alone does not. Use Conventional Commit titles when squash merging. Humans add their own DCO sign-off; automation must not fabricate one. Release Please PRs created with GITHUB_TOKEN do not automatically trigger PR workflows: trigger validation explicitly or use a suitably scoped GitHub App token if required branch checks depend on those events.

## License review

Vem Data source and its package LICENSE are Apache-2.0. Adapted shadcn UI components retain MIT attribution. Poppins is OFL-1.1 with its notice shipped in the site. Third-party packages retain their licenses; repository-wide Apache annotations do not relicense them.

The dependency graph also contains build-time native image/CSS tools under LGPL and MPL licenses. They are not intended to ship in the static site or Vem Data tarball. Distribution review must distinguish the emitted artifacts from the development dependency graph. The Hye logo is reserved branding under `LICENSES/LicenseRef-Hye-Branding.txt`, explicitly excluded from the Apache grant.
