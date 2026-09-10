# TB Toolkit v4

Static website for TBToolkit.com.

## Development and releases

- Run `node scripts/build-site.mjs` (or `npm run build`) to create the production site in `dist/`.
- The build computes one content-derived asset identity and applies it to scripts, styles, ES-module imports, and workers. Manual `?v=` values in source HTML are ignored in production output.
- `dist/deployment-manifest.json` records the package release, Git commit, asset identity, build time, and browser-storage schema.
- Change the version once in `package.json` when preparing a release; `package-lock.json` must remain synchronized.
- Browser account data uses the stable `tbtoolkit.stackingCalculator` key and an explicit schema version. Add each future migration to `js/saved-state-schema.mjs`; do not rename the storage key for ordinary releases.
- Pull requests run the regression and production-build checks. A successful push to `main` deploys the exact generated `dist/` artifact through GitHub Pages.

Before merging a release, run:

```text
npm test
npm run test:release
```

Changes in v4:
- Rebuilt the homepage hero as real HTML/CSS instead of displaying the entire mockup image.
- Reduced desktop hero height and removed the dark overlay problem.
- Uses a cleaner cropped Carter/Jago hero treatment from the approved artwork.
- Restored a small illustrated Biff portrait instead of the live-action photo.
- Added the BIFF STACK v2.2 OneDrive link.
- Embedded the Total Battle Google event calendar.
- Retained the Research spreadsheet link and mobile-responsive layout.


## v6 update
- Removed the Biff quote/image panel from the homepage.
- Rebalanced the lower homepage section into two columns.


## v7 changes
- Removed the language selector from the header.
- Rebuilt the mobile hero so artwork and text are separate stacked sections, preventing text overlays.
