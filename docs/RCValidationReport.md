<!-- markdownlint-disable-file MD012 MD014 -->

# DevForgeKit RC Validation Report

**Version:** 3.0.0
**Commit:** `923590abfd8f900b6e109ace72da511700051611` (distribution-verification)
**Started:** 2026-07-12T09:29:07Z
**Finished:** 2026-07-12T09:39:24Z

## Final recommendation: FAIL

At least one required check failed - see the ❌ items below. Fix them and re-run `./scripts/rc-validate.sh` before tagging.

## 1. GitHub Release verification

- ✅ **GitHub Release v3.0.0 exists**
  <details><summary>output</summary>

  ```
  {"assets":[{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/469598635","contentType":"application/octet-stream","createdAt":"2026-07-07T22:04:49Z","digest":"sha256:a9273fa371515697b5923636fc9299325392b39ada9f0e8ebf4d2cdc8c19b7f4","downloadCount":1,"id":"RA_kwDOTNA9s84b_YGr","label":"","name":"Brewfile","size":5891,"state":"uploaded","updatedAt":"2026-07-07T22:04:49Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/v3.0.0/Brewfile"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/469598639","contentType":"application/octet-stream","createdAt":"2026-07-07T22:04:49Z","digest":"sha256:7389a7f589b9532ffada9897d6620c8cca1a2d77b24810cb2781ad882e1712d9","downloadCount":0,"id":"RA_kwDOTNA9s84b_YGv","label":"","name":"CHANGELOG.md","size":72348,"state":"uploaded","updatedAt":"2026-07-07T22:04:49Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/v3.0.0/CHANGELOG.md"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/469598637","contentType":"text/plain; charset=utf-8","createdAt":"2026-07-07T22:04:49Z","digest":"sha256:5b763e8fda105949278aae1bb74b01095e3517eeab459149caba99e95002f1d1","downloadCount":0,"id":"RA_kwDOTNA9s84b_YGt","label":"","name":"health-report.txt","size":1582,"state":"uploaded","updatedAt":"2026-07-07T22:04:49Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/v3.0.0/health-report.txt"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/469598640","contentType":"application/octet-stream","createdAt":"2026-07-07T22:04:49Z","digest":"sha256:940da75013f27aa9f5010004d87fcc3242663380e8125c4721b361359ffe61a8","downloadCount":0,"id":"RA_kwDOTNA9s84b_YGw","label":"","name":"README.md","size":20512,"state":"uploaded","updatedAt":"2026-07-07T22:04:49Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/v3.0.0/README.md"},{"apiUrl":"https://api.github.com/repos/NouradinAbdurahman/DevForgeKit/releases/assets/469598636","contentType":"application/octet-stream","createdAt":"2026-07-07T22:04:49Z","digest":"sha256:2985be8b28d3ade858e8d8fb4bc22f565b1bf6020dff982dce141f7721b9999c","downloadCount":4,"id":"RA_kwDOTNA9s84b_YGs","label":"","name":"VERSION","size":6,"state":"uploaded","updatedAt":"2026-07-07T22:04:49Z","url":"https://github.com/NouradinAbdurahman/DevForgeKit/releases/download/v3.0.0/VERSION"}],"publishedAt":"2026-07-07T22:04:49Z","tagName":"v3.0.0"}

  ```
  </details>

- ✅ **Download a real release asset (VERSION) and verify its checksum**
  <details><summary>output</summary>

  ```
  2985be8b28d3ade858e8d8fb4bc22f565b1bf6020dff982dce141f7721b9999c  release-VERSION

  ```
  </details>

DevForgeKit ships as a git-clone/npm/Homebrew tool, not a standalone compiled binary attached to the GitHub Release - the 'run the executable / --version / --help / doctor' checks the checklist calls for are covered against the npm install (section 2) and the Homebrew install (section 3) below, which are the actual executable distribution channels.


## 2. npm verification

- ✅ **npm pack --dry-run**
  <details><summary>output</summary>

  ```
  npm notice 427B templates/react-native/App.js
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.0
  npm notice filename: devforgekit-3.0.0.tgz
  npm notice package size: 1.0 MB
  npm notice unpacked size: 4.0 MB
  npm notice shasum: e5682d6c346c253a7d0e904081d5ed052cc256bb
  npm notice integrity: sha512-BgCQd3I1+5R9e[...]HppeRR5oqAf9Q==
  npm notice total files: 1011
  npm notice
  devforgekit-3.0.0.tgz

  ```
  </details>

- ✅ **npm publish --dry-run**
  <details><summary>output</summary>

  ```
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.0
  npm notice filename: devforgekit-3.0.0.tgz
  npm notice package size: 1.0 MB
  npm notice unpacked size: 4.0 MB
  npm notice shasum: e5682d6c346c253a7d0e904081d5ed052cc256bb
  npm notice integrity: sha512-BgCQd3I1+5R9e[...]HppeRR5oqAf9Q==
  npm notice total files: 1011
  npm notice
  npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
  + devforgekit@3.0.0

  ```
  </details>

- ✅ **npm pack (real tarball)**
  <details><summary>output</summary>

  ```
  npm notice 427B templates/react-native/App.js
  npm notice 49B templates/react-native/app.json
  npm notice 167B templates/react-native/index.js
  npm notice 1.1kB templates/react-native/LICENSE
  npm notice 361B templates/react-native/package.json
  npm notice 903B templates/react-native/README.md
  npm notice 188B templates/react/.editorconfig
  npm notice 293B templates/react/index.html
  npm notice 1.1kB templates/react/LICENSE
  npm notice 351B templates/react/package.json
  npm notice 559B templates/react/README.md
  npm notice 67B templates/react/src/App.jsx
  npm notice 214B templates/react/src/main.jsx
  npm notice 136B templates/react/vite.config.js
  npm notice 188B templates/supabase/.editorconfig
  npm notice 1.1kB templates/supabase/LICENSE
  npm notice 1.0kB templates/supabase/README.md
  npm notice 15.5kB templates/supabase/supabase/config.toml
  npm notice 276B templates/supabase/supabase/migrations/00000000000000_init.sql
  npm notice 188B templates/terraform/.editorconfig
  npm notice 1.1kB templates/terraform/LICENSE
  npm notice 90B templates/terraform/main.tf
  npm notice 120B templates/terraform/outputs.tf
  npm notice 925B templates/terraform/README.md
  npm notice 312B templates/terraform/variables.tf
  npm notice 153B templates/terraform/versions.tf
  npm notice 2.2kB vscode/extensions.txt
  npm notice 198B vscode/keybindings.json
  npm notice 2.2kB vscode/settings.json
  npm notice Tarball Details
  npm notice name: devforgekit
  npm notice version: 3.0.0
  npm notice filename: devforgekit-3.0.0.tgz
  npm notice package size: 1.0 MB
  npm notice unpacked size: 4.0 MB
  npm notice shasum: e5682d6c346c253a7d0e904081d5ed052cc256bb
  npm notice integrity: sha512-BgCQd3I1+5R9e[...]HppeRR5oqAf9Q==
  npm notice total files: 1011
  npm notice
  devforgekit-3.0.0.tgz

  ```
  </details>

- ✅ **npm install -g (scratch prefix, never the real global npm)**
  <details><summary>output</summary>

  ```
  
  added 1 package in 1s
  npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
  npm warn allow-scripts   devforgekit@3.0.0 (postinstall: scripts/npm-postinstall.sh)
  npm warn allow-scripts
  npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
  Reshimming mise lts...

  ```
  </details>

- ✅ **devforgekit --version (npm install)**
  <details><summary>output</summary>

  ```
  Setting up the DevForgeKit CLI (first run only)...

  ```
  </details>

- ✅ **devforgekit --help (npm install)**
  <details><summary>output</summary>

  ```
    $ devforgekit compatibility export ./compatibility-report.md
    $ devforgekit ai providers
    $ devforgekit ai doctor
    $ devforgekit ai chat
    $ devforgekit ai generate "A REST API with JWT using FastAPI and PostgreSQL"
    $ devforgekit theme list
    $ devforgekit theme use nord
    $ devforgekit theme preview dracula
    $ devforgekit theme export -o my-theme.yaml
    $ devforgekit self-update
    $ devforgekit snapshot create
    $ devforgekit snapshot restore machine.dfk
    $ devforgekit snapshot list
    $ devforgekit snapshot inspect machine.dfk
    $ devforgekit snapshot verify machine.dfk
    $ devforgekit snapshot diff old.dfk new.dfk
    $ devforgekit benchmark quick
    $ devforgekit benchmark full
    $ devforgekit benchmark history
    $ devforgekit benchmark compare
    $ devforgekit repair scan
    $ devforgekit repair run
    $ devforgekit repair history
    $ devforgekit package analyze
    $ devforgekit package info flutter
    $ devforgekit package tree flutter
    $ devforgekit package orphan
    $ devforgekit package duplicates
    $ devforgekit graph open
    $ devforgekit graph impact flutter
    $ devforgekit graph path node docker
    $ devforgekit graph stats
    $ devforgekit env doctor
    $ devforgekit env list
    $ devforgekit env regenerate
    $ devforgekit env graph java
    $ devforgekit env diff
    $ devforgekit env watch
    $ devforgekit explain flutter
  

  ```
  </details>

- ✅ **devforgekit doctor (npm install)**
  <details><summary>output</summary>

  ```
        "status": "WARNING",
        "description": "Component check: xcodegen"
      },
      {
        "status": "PASS",
        "description": "Component check: yarn"
      },
      {
        "status": "PASS",
        "description": "Component check: yq"
      },
      {
        "status": "WARNING",
        "description": "Component check: yt-dlp"
      },
      {
        "status": "WARNING",
        "description": "Component check: zed"
      },
      {
        "status": "WARNING",
        "description": "Component check: zen-browser"
      },
      {
        "status": "WARNING",
        "description": "Component check: zig"
      },
      {
        "status": "WARNING",
        "description": "Component check: zoxide"
      }
    ],
    "pass": 68,
    "warn": 193,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **devforgekit check (npm install)**
  <details><summary>output</summary>

  ```
  ✓ Component check: supabase
  ✓ Component check: swift
  ! Component check: swiftformat
  ! Component check: swiftlint
  ! Component check: tauri-cli
  ✓ Component check: tcpdump
  ✓ Component check: terraform
  ! Component check: tlrc
  ! Component check: tmux
  ✓ Component check: tree
  ! Component check: typedoc
  ! Component check: unity-hub
  ! Component check: uv
  ! Component check: vagrant
  ! Component check: vault
  ✓ Component check: vercel
  ! Component check: victor-mono
  ! Component check: vlc
  ! Component check: volta
  ✓ Component check: vscode
  ! Component check: warp
  ! Component check: watchexec
  ✓ Component check: watchman
  ! Component check: wezterm
  ✓ Component check: wget
  ! Component check: whisper-cpp
  ! Component check: whois
  ! Component check: windsurf
  ! Component check: wireshark
  ! Component check: xcbeautify
  ✓ Component check: xcode
  ! Component check: xcodegen
  ✓ Component check: yarn
  ✓ Component check: yq
  ! Component check: yt-dlp
  ! Component check: zed
  ! Component check: zen-browser
  ! Component check: zig
  ! Component check: zoxide
  i Component health score: 63% - Machine Needs Attention

  ```
  </details>

- ✅ **devforgekit component list (npm install)**
  <details><summary>output</summary>

  ```
    golangci-lint - A fast Go linters aggregator
    prettier - An opinionated code formatter
    shellcheck - A static analysis tool for shell scripts
  
  Media
    exiftool - Reads, writes, and edits file metadata (EXIF, IPTC, XMP)
    ffmpeg - A complete cross-platform solution to record, convert, and stream audio/video
    imagemagick - A software suite to create, edit, and compose bitmap images
    sox - A cross-platform command-line audio processing tool
    vlc - A free and open-source cross-platform multimedia player
    yt-dlp - A feature-rich command-line audio/video downloader
  
  Design
    figma - A collaborative interface design tool
    rive - A real-time interactive design and animation tool
  
  Android
    genymotion - An Android emulator for app development and testing
    scrcpy - Display and control an Android device from macOS
  
  API Development
    grpcurl - A command-line tool for interacting with gRPC servers
    httpie - A user-friendly command-line HTTP client
    insomnia - A collaborative API client for REST, GraphQL, and gRPC
    openapi-generator-cli - Generates API clients/servers/docs from an OpenAPI spec
  
  Kubernetes
    helm - The package manager for Kubernetes
    k9s - A terminal UI to interact with your Kubernetes clusters
    kubectl - The Kubernetes command-line tool
    kubectx - Fast context switching between Kubernetes clusters
    kubens - Fast namespace switching for Kubernetes (installed alongside kubectx)
    kustomize - Customize raw, template-free Kubernetes YAML manifests
    skaffold - Continuous development for Kubernetes applications
  
  Documentation
    hugo - A fast static site generator
    mkdocs - A fast, simple static site generator for project documentation
    sphinx - A documentation generator, the standard for Python projects
    typedoc - A documentation generator for TypeScript projects

  ```
  </details>

- ✅ **devforgekit new nextjs demo-npm (npm install)**
  <details><summary>output</summary>

  ```
  Recommended with Next.js
  ──────────────────────────────────────────────────────────────────────────────
  PACKAGE   DESCRIPTION                                            
  ────────  ───────────────────────────────────────────────────────
  vercel    The Vercel deployment platform's command-line interface
  eslint    A pluggable linter for JavaScript and TypeScript       
  prettier  An opinionated code formatter                          
  ──────────────────────────────────────────────────────────────────────────────
  i Generating Next.js project 'demo-npm' in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/npm-project/...
  → Scaffolding Next.js project with the official CLI...
  Creating a new Next.js app in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/npm-project/demo-npm.
  
  Using npm.
  
  Initializing project with template: app-tw 
  
  Initialized a git repository.
  
  Success! Created demo-npm at /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/npm-project/demo-npm
  
  Project Created
  ──────────────────────────────────────────────────────────────────────────────
  Location:      /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/npm-project/demo-npm
  Stack:         Next.js
  License:       MIT
  Git:           initialized
  CI workflow:   ✓ yes
  Docker:        ✓ yes
  README:        ✓ yes
  ──────────────────────────────────────────────────────────────────────────────
  
  Next commands
    → cd demo-npm
    → npm install
    → cp .env.example .env.local
    → npm run dev

  ```
  </details>

- ✅ **npm uninstall -g devforgekit (scratch prefix)**
  <details><summary>output</summary>

  ```
  
  removed 1 package in 241ms

  ```
  </details>


## 3. Homebrew verification

- ✅ **brew style Formula/devforgekit.rb**
  <details><summary>output</summary>

  ```
  
  1 file inspected, no offenses detected

  ```
  </details>

- ✅ **brew audit --formula local/devforgekit-rc-validate/devforgekit**
- ⚠️ **brew install --build-from-source** - the Formula built and installed into the Cellar correctly; only the final "brew link" step was skipped, because this development machine already has a real, non-Homebrew devforgekit on PATH (from dogfooding this checkout directly). Verified separately by the homebrew-formula.yml CI workflow on a clean runner with no pre-existing install.

- ✅ **devforgekit --version (Homebrew install)**
- ✅ **devforgekit doctor (Homebrew install)**
  <details><summary>output</summary>

  ```
        "status": "WARNING",
        "description": "Component check: xcodegen"
      },
      {
        "status": "PASS",
        "description": "Component check: yarn"
      },
      {
        "status": "PASS",
        "description": "Component check: yq"
      },
      {
        "status": "WARNING",
        "description": "Component check: yt-dlp"
      },
      {
        "status": "WARNING",
        "description": "Component check: zed"
      },
      {
        "status": "WARNING",
        "description": "Component check: zen-browser"
      },
      {
        "status": "WARNING",
        "description": "Component check: zig"
      },
      {
        "status": "WARNING",
        "description": "Component check: zoxide"
      }
    ],
    "pass": 72,
    "warn": 189,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **brew upgrade devforgekit (expected no-op at the same version)**
  <details><summary>output</summary>

  ```
  Warning: local/devforgekit-rc-validate/devforgekit 3.0.0 already installed

  ```
  </details>

- ✅ **devforgekit doctor after brew upgrade (Homebrew install)**
  <details><summary>output</summary>

  ```
        "status": "WARNING",
        "description": "Component check: xcodegen"
      },
      {
        "status": "PASS",
        "description": "Component check: yarn"
      },
      {
        "status": "PASS",
        "description": "Component check: yq"
      },
      {
        "status": "WARNING",
        "description": "Component check: yt-dlp"
      },
      {
        "status": "WARNING",
        "description": "Component check: zed"
      },
      {
        "status": "WARNING",
        "description": "Component check: zen-browser"
      },
      {
        "status": "WARNING",
        "description": "Component check: zig"
      },
      {
        "status": "WARNING",
        "description": "Component check: zoxide"
      }
    ],
    "pass": 72,
    "warn": 189,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **brew uninstall devforgekit**
  <details><summary>output</summary>

  ```
  Uninstalling /opt/homebrew/Cellar/devforgekit/3.0.0... (6,510 files, 20.7MB)

  ```
  </details>


## 4. Installation verification

- ✅ **bootstrap.sh --dry-run --yes (fresh install path, no side effects)**
  <details><summary>output</summary>

  ```
  === Verification ===
  ℹ Skipping post-install verification in --dry-run mode
  
  === Summary ===
    ✔ Homebrew present
    ⚠ Brewfile is valid (brew bundle check) (exit 1)
    ✔ mise.toml present
    ✔ vscode/settings.json present
    ✔ cursor/settings.json present
    ✔ cli/package.json present
    ✔ Generate system report
  
  6 passed, 1 warnings, 0 failed
  
  =========================================
  ✔ Homebrew
  ✔ Git
  ✔ GitHub CLI
  ✔ SSH
  ✔ Node
  ✔ pnpm
  ✔ Java
  ✔ Python
  ✔ Flutter
  ✔ Android SDK
  ✔ Docker
  ✔ PostgreSQL
  ✔ MySQL
  ✔ Redis
  ✔ Supabase CLI
  ✔ VS Code
  ✔ Cursor
  ✔ DevForgeKit
  =========================================
  
  ██████████████████████░░  92%
  Health Score: 92%
  Machine Ready
  ✔ DevForgeKit installation completed successfully.
  Execution time: 0m 18s

  ```
  </details>

- ✅ **devforgekit env doctor (environment verification)**
  <details><summary>output</summary>

  ```
  {
    "state": {
      "packages": {},
      "files": {},
      "generatedAt": null,
      "version": 2
    },
    "model": {
      "path": [],
      "pathOwners": {},
      "variables": {},
      "shell": [],
      "sourcePackages": [],
      "missingPackages": [],
      "collisions": []
    },
    "results": [
      {
        "status": "FAIL",
        "message": "Generated shell file for zsh does not exist - run 'devforgekit env regenerate'"
      },
      {
        "status": "WARNING",
        "message": "Shell hook is not installed for zsh - run 'devforgekit env regenerate'"
      }
    ],
    "shell": "zsh",
    "score": {
      "pass": 0,
      "warn": 1,
      "fail": 1,
      "total": 2,
      "score": 25,
      "verdict": "Machine Needs Attention"
    },
    "packageHealth": []
  }

  ```
  </details>

- ✅ **devforgekit env regenerate (PATH + environment file generation, scratch $HOME)**
  <details><summary>output</summary>

  ```
  i No packages have registered environment configuration yet - nothing to generate.

  ```
  </details>

- ✅ **devforgekit (global command, non-TTY dashboard fallback)**

- ✅ **devforgekit check (health score)**
  <details><summary>output</summary>

  ```
  ✓ Component check: supabase
  ✓ Component check: swift
  ! Component check: swiftformat
  ! Component check: swiftlint
  ! Component check: tauri-cli
  ✓ Component check: tcpdump
  ✓ Component check: terraform
  ! Component check: tlrc
  ! Component check: tmux
  ✓ Component check: tree
  ! Component check: typedoc
  ! Component check: unity-hub
  ! Component check: uv
  ! Component check: vagrant
  ! Component check: vault
  ✓ Component check: vercel
  ! Component check: victor-mono
  ! Component check: vlc
  ! Component check: volta
  ✓ Component check: vscode
  ! Component check: warp
  ! Component check: watchexec
  ✓ Component check: watchman
  ! Component check: wezterm
  ✓ Component check: wget
  ! Component check: whisper-cpp
  ! Component check: whois
  ! Component check: windsurf
  ! Component check: wireshark
  ! Component check: xcbeautify
  ✓ Component check: xcode
  ! Component check: xcodegen
  ✓ Component check: yarn
  ✓ Component check: yq
  ! Component check: yt-dlp
  ! Component check: zed
  ! Component check: zen-browser
  ! Component check: zig
  ! Component check: zoxide
  i Component health score: 63% - Machine Needs Attention

  ```
  </details>

- ✅ **devforgekit env snapshot** (id: 2026-07-12T09-30-42-787Z)

- ✅ **devforgekit env restore 2026-07-12T09-30-42-787Z**
  <details><summary>output</summary>

  ```
  i Current state saved as safety snapshot 2026-07-12T09-30-42-950Z
  i No packages have registered environment configuration yet - nothing to generate.

  ```
  </details>

- ✅ **devforgekit repair scan (read-only)**
  <details><summary>output</summary>

  ```
      },
      "dependencies": []
    },
    {
      "id": "ssh-no-keys",
      "title": "SSH: no keys found",
      "severity": "INFO",
      "category": "ssh",
      "categoryLabel": "SSH",
      "subsystem": "ssh",
      "confidence": "high",
      "description": "No SSH directory found",
      "impact": "Git over SSH and remote access will not work",
      "fix": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
      "action": {
        "type": "manual",
        "suggestion": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'"
      },
      "risk": "low",
      "riskLabel": "Low",
      "estimatedTime": "2 min",
      "requiresRestart": false,
      "rollbackAvailable": true,
      "supportsDryRun": true,
      "platforms": [
        "macos"
      ],
      "versionIntroduced": "2.1.6",
      "explanation": {
        "problem": "No SSH directory found",
        "impact": "Git over SSH and remote access will not work",
        "fix": "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
        "risk": "Low",
        "estimatedTime": "2 min",
        "rollbackAvailable": true,
        "requiresRestart": false
      },
      "dependencies": []
    }
  ]

  ```
  </details>


## 5. Smoke tests

- ✅ **devforgekit (no args)**

- ✅ **devforgekit doctor**
  <details><summary>output</summary>

  ```
        "status": "WARNING",
        "description": "Component check: xcodegen"
      },
      {
        "status": "PASS",
        "description": "Component check: yarn"
      },
      {
        "status": "PASS",
        "description": "Component check: yq"
      },
      {
        "status": "WARNING",
        "description": "Component check: yt-dlp"
      },
      {
        "status": "WARNING",
        "description": "Component check: zed"
      },
      {
        "status": "WARNING",
        "description": "Component check: zen-browser"
      },
      {
        "status": "WARNING",
        "description": "Component check: zig"
      },
      {
        "status": "WARNING",
        "description": "Component check: zoxide"
      }
    ],
    "pass": 72,
    "warn": 189,
    "fail": 0,
    "total": 261,
    "score": 63,
    "verdict": "Machine Needs Attention",
    "compatibility": null
  }

  ```
  </details>

- ✅ **devforgekit check**
  <details><summary>output</summary>

  ```
  ✓ Component check: supabase
  ✓ Component check: swift
  ! Component check: swiftformat
  ! Component check: swiftlint
  ! Component check: tauri-cli
  ✓ Component check: tcpdump
  ✓ Component check: terraform
  ! Component check: tlrc
  ! Component check: tmux
  ✓ Component check: tree
  ! Component check: typedoc
  ! Component check: unity-hub
  ! Component check: uv
  ! Component check: vagrant
  ! Component check: vault
  ✓ Component check: vercel
  ! Component check: victor-mono
  ! Component check: vlc
  ! Component check: volta
  ✓ Component check: vscode
  ! Component check: warp
  ! Component check: watchexec
  ✓ Component check: watchman
  ! Component check: wezterm
  ✓ Component check: wget
  ! Component check: whisper-cpp
  ! Component check: whois
  ! Component check: windsurf
  ! Component check: wireshark
  ! Component check: xcbeautify
  ✓ Component check: xcode
  ! Component check: xcodegen
  ✓ Component check: yarn
  ✓ Component check: yq
  ! Component check: yt-dlp
  ! Component check: zed
  ! Component check: zen-browser
  ! Component check: zig
  ! Component check: zoxide
  i Component health score: 63% - Machine Needs Attention

  ```
  </details>

- ✅ **devforgekit component list**
  <details><summary>output</summary>

  ```
    golangci-lint - A fast Go linters aggregator
    prettier - An opinionated code formatter
    shellcheck - A static analysis tool for shell scripts
  
  Media
    exiftool - Reads, writes, and edits file metadata (EXIF, IPTC, XMP)
    ffmpeg - A complete cross-platform solution to record, convert, and stream audio/video
    imagemagick - A software suite to create, edit, and compose bitmap images
    sox - A cross-platform command-line audio processing tool
    vlc - A free and open-source cross-platform multimedia player
    yt-dlp - A feature-rich command-line audio/video downloader
  
  Design
    figma - A collaborative interface design tool
    rive - A real-time interactive design and animation tool
  
  Android
    genymotion - An Android emulator for app development and testing
    scrcpy - Display and control an Android device from macOS
  
  API Development
    grpcurl - A command-line tool for interacting with gRPC servers
    httpie - A user-friendly command-line HTTP client
    insomnia - A collaborative API client for REST, GraphQL, and gRPC
    openapi-generator-cli - Generates API clients/servers/docs from an OpenAPI spec
  
  Kubernetes
    helm - The package manager for Kubernetes
    k9s - A terminal UI to interact with your Kubernetes clusters
    kubectl - The Kubernetes command-line tool
    kubectx - Fast context switching between Kubernetes clusters
    kubens - Fast namespace switching for Kubernetes (installed alongside kubectx)
    kustomize - Customize raw, template-free Kubernetes YAML manifests
    skaffold - Continuous development for Kubernetes applications
  
  Documentation
    hugo - A fast static site generator
    mkdocs - A fast, simple static site generator for project documentation
    sphinx - A documentation generator, the standard for Python projects
    typedoc - A documentation generator for TypeScript projects

  ```
  </details>

- ✅ **devforgekit env doctor**
  <details><summary>output</summary>

  ```
  {
    "state": {
      "packages": {},
      "files": {},
      "generatedAt": null,
      "version": 2
    },
    "model": {
      "path": [],
      "pathOwners": {},
      "variables": {},
      "shell": [],
      "sourcePackages": [],
      "missingPackages": [],
      "collisions": []
    },
    "results": [
      {
        "status": "FAIL",
        "message": "Generated shell file for zsh does not exist - run 'devforgekit env regenerate'"
      },
      {
        "status": "WARNING",
        "message": "Shell hook is not installed for zsh - run 'devforgekit env regenerate'"
      }
    ],
    "shell": "zsh",
    "score": {
      "pass": 0,
      "warn": 1,
      "fail": 1,
      "total": 2,
      "score": 25,
      "verdict": "Machine Needs Attention"
    },
    "packageHealth": []
  }

  ```
  </details>

- ✅ **devforgekit registry audit**
  <details><summary>output</summary>

  ```
                          COUNT
  ──────────────────────  ─────
  Missing install method  0    
  Missing validate        0    
  Missing uninstall       0    
  Missing upgrade method  0    
  Missing repair method   0    
  Missing version         0    
  Missing binary          0    
  Missing dependencies    0    
  Missing conflicts       0    
  Missing environment     31   
  Unsupported packages    1    
  
  linux gaps (193): act, age, aider, aircrack-ng, alacritty, android-studio, arangodb, arc, arduino-cli, atuin, ... and 183 more
  
  windows gaps (206): act, age, aider, aircrack-ng, alacritty, android-studio, arangodb, arc, arduino-cli, asdf, ... and 196 more
  Registry Audit
  ──────────────────────────────────────────────────────────────────────────────
  █████████████████████░░░  89%
  
  Packages:                261
  Verified (CI):           5 (2%)
  Untested:                256 (98%)
  Deprecated:              0
  Broken Metadata:         1
  ──────────────────────────────────────────────────────────────────────────────
  
  Coverage
                 COVERAGE
  ─────────────  ────────
  Compatibility  75%     
  Documentation  100%    
  Validation     100%    
  Aliases        100%    
  Architecture   100%    
  Recommendations
  ──────────────────────────────────────────────────────────────────────────────
  - Only 5 package(s) are CI-verified - consider adding more to .github/workflows/registry-smoke.yml's live-tested allowlist.
  ──────────────────────────────────────────────────────────────────────────────

  ```
  </details>

- ✅ **devforgekit new nextjs demo-smoke**
  <details><summary>output</summary>

  ```
  Recommended with Next.js
  ──────────────────────────────────────────────────────────────────────────────
  PACKAGE   DESCRIPTION                                            
  ────────  ───────────────────────────────────────────────────────
  vercel    The Vercel deployment platform's command-line interface
  eslint    A pluggable linter for JavaScript and TypeScript       
  prettier  An opinionated code formatter                          
  ──────────────────────────────────────────────────────────────────────────────
  i Generating Next.js project 'demo-smoke' in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/smoke-project/...
  → Scaffolding Next.js project with the official CLI...
  Creating a new Next.js app in /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/smoke-project/demo-smoke.
  
  Using npm.
  
  Initializing project with template: app-tw 
  
  Initialized a git repository.
  
  Success! Created demo-smoke at /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/smoke-project/demo-smoke
  
  Project Created
  ──────────────────────────────────────────────────────────────────────────────
  Location:      /private/var/folders/tb/vd1vnhvd03q7rr2z7pd36hcc0000gn/T/devforgekit-rc-validate.l8SGKb/smoke-project/demo-smoke
  Stack:         Next.js
  License:       MIT
  Git:           initialized
  CI workflow:   ✓ yes
  Docker:        ✓ yes
  README:        ✓ yes
  ──────────────────────────────────────────────────────────────────────────────
  
  Next commands
    → cd demo-smoke
    → npm install
    → cp .env.example .env.local
    → npm run dev

  ```
  </details>

- ✅ **devforgekit repair scan**
  <details><summary>output</summary>

  ```
    {
      "id": "cache-homebrew-cache",
      "title": "Cache: Homebrew cache oversized",
      "severity": "INFO",
      "category": "cache",
      "categoryLabel": "Cache",
      "subsystem": "filesystem",
      "confidence": "high",
      "description": "Homebrew cache is 5.1 GB (>5 GB threshold)",
      "impact": "Excessive disk usage from cached files",
      "fix": "Clear cache: rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
      "action": {
        "type": "shell",
        "command": "rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
        "filesAffected": [
          "/Users/nouradin/Library/Caches/Homebrew"
        ]
      },
      "risk": "low",
      "riskLabel": "Low",
      "estimatedTime": "1 min",
      "requiresRestart": false,
      "rollbackAvailable": true,
      "supportsDryRun": true,
      "platforms": [
        "macos"
      ],
      "versionIntroduced": "2.1.6",
      "explanation": {
        "problem": "Homebrew cache is 5.1 GB (>5 GB threshold)",
        "impact": "Excessive disk usage from cached files",
        "fix": "Clear cache: rm -rf '/Users/nouradin/Library/Caches/Homebrew'",
        "risk": "Low",
        "estimatedTime": "1 min",
        "rollbackAvailable": true,
        "requiresRestart": false
      },
      "dependencies": []
    }
  ]

  ```
  </details>


## 6. Package integrity

- ❌ **devforgekit doctor --release-check (version consistency, docs, artifacts, registry, git tree, CI status)** (exit 1)
  <details><summary>output</summary>

  ```
  
  === Release readiness check ===
  i ✓ Version consistency: All sources agree on 3.0.0 (VERSION=3.0.0, package.json=3.0.0, cli/package.json=3.0.0, Formula/devforgekit.rb=3.0.0)
  i - Release tag: HEAD is not currently on a tag - not a release commit yet
  i ✓ Required documentation: All present: LICENSE, README.md, CHANGELOG.md, RELEASE.md, SECURITY.md
  i ✓ Distribution artifacts: All present: package.json, Formula/devforgekit.rb, scripts/npm-postinstall.sh, completions/devforgekit.bash, completions/devforgekit.zsh, completions/devforgekit.fish
  i ✓ Registry: lint clean, format clean, quality score 89%, 202 orphan/warning notice(s) (non-blocking)
  i ✓ Outstanding pending-work markers: None found in cli/src
  i ✓ No experimental/debug flags enabled: No internal debug env vars set. Note: the ai command family is intentionally Experimental (see docs/ApiFreeze.md) - not a blocker.
  ✗ ✗ Git working tree: 3 uncommitted change(s): M docs/RCValidationReport.md,  M scripts/rc-validate.sh, ?? cli/nul
  ✗ ✗ CI status: 3 of 10 run(s) failed for this commit
  i Release check: FAIL - resolve the failing check(s) above before releasing.

  ```
  </details>


## 7. Regression suite

- ✅ **scripts/validate.sh (ShellCheck, bash -n, Brewfile, mise.toml, JSON, YAML, Markdown)**
  <details><summary>output</summary>

  ```
    ✔ Markdown non-empty: docs/CompatibilityReport.md
    ✔ Markdown non-empty: docs/CompatibilityRules.md
    ✔ Markdown non-empty: docs/Security.md
    ✔ Markdown non-empty: docs/InstallationAudit.md
    ✔ Markdown non-empty: docs/CommandSafety.md
    ✔ Markdown non-empty: cli/README.md
    ✔ Markdown non-empty: README.md
    ✔ Markdown non-empty: RELEASE.md
    ✔ Markdown non-empty: CONTRIBUTING.md
    ✔ Markdown non-empty: .github/PULL_REQUEST_TEMPLATE.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/feature_request.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/docs_issue.md
    ✔ Markdown non-empty: .github/ISSUE_TEMPLATE/bug_report.md
    ✔ Markdown non-empty: registry/research-queue.md
    ✔ Markdown non-empty: templates/terraform/README.md
    ✔ Markdown non-empty: templates/nodejs/README.md
    ✔ Markdown non-empty: templates/docker/README.md
    ✔ Markdown non-empty: templates/react-native/README.md
    ✔ Markdown non-empty: templates/python/README.md
    ✔ Markdown non-empty: templates/express/README.md
    ✔ Markdown non-empty: templates/supabase/README.md
    ✔ Markdown non-empty: templates/flutter/README.md
    ✔ Markdown non-empty: templates/firebase/README.md
    ✔ Markdown non-empty: templates/fastapi/README.md
    ✔ Markdown non-empty: templates/nextjs/README.md
    ✔ Markdown non-empty: templates/nestjs/README.md
    ✔ Markdown non-empty: templates/docker-compose/README.md
    ✔ Markdown non-empty: templates/react/README.md
    ✔ Markdown non-empty: profiles/full/README.md
    ✔ Markdown non-empty: profiles/recommended/README.md
    ✔ Markdown non-empty: profiles/backend/README.md
    ✔ Markdown non-empty: profiles/minimal/README.md
    ✔ Markdown non-empty: profiles/flutter/README.md
    ✔ Markdown non-empty: profiles/custom/README.md
    ✔ Markdown non-empty: CLAUDE.md
    ✔ Markdown non-empty: SECURITY.md
    ✔ Node CLI lint
    ✔ Node CLI tests
  
  763 passed, 1 warnings, 0 failed

  ```
  </details>

- ✅ **npm test --prefix cli (full unit + integration suite)**
  <details><summary>output</summary>

  ```
  ✔ createSnapshot records the document verbatim plus metadata, and listSnapshots sorts newest-first (103.49175ms)
  ✔ listSnapshots returns [] for a workspace with no snapshots yet (0.941458ms)
  ✔ getSnapshotDoc/restoreSnapshot/deleteSnapshot throw a clear error for an unknown id (1.002417ms)
  ✔ restoreSnapshot reverts fields but always keeps the workspace's real name/createdAt (1.541625ms)
  ✔ deleteSnapshot removes exactly that snapshot (2.902125ms)
  ✔ exportSnapshot writes the recorded document to an arbitrary file path (1.644625ms)
  ✔ compareSnapshots/compareWithCurrent report added/removed/changed top-level keys (3.637917ms)
  ✔ PROVIDER_DEFAULT_HOSTS exposes the three well-known providers (1.377416ms)
  ✔ applyWorkspaceSsh writes a Host block per identity, mode 0600, preserving pre-existing config content (4.981791ms)
  ✔ re-applying the same workspace is idempotent (no duplicate Host blocks) (1.287417ms)
  ✔ a workspace with no identities removes its own block instead of leaving a stale one (0.676625ms)
  ✔ two workspaces' SSH blocks coexist independently (0.898125ms)
  ✔ ensureKnownHost recognizes an already-known host without shelling out to ssh-keyscan (no network) (18.214875ms)
  ✔ removeWorkspaceSsh returns false when the workspace never had a block (0.725ms)
  ✔ createWorkspace persists a workspace.json under ~/.config/devforgekit/workspaces/<name>/ (23.965875ms)
  ✔ createWorkspace rejects a duplicate name and an invalid name (2.366709ms)
  ✔ getWorkspace throws a clear error for an unknown workspace (0.850458ms)
  ✔ saveWorkspace re-validates, persists changes, and stamps a fresh modifiedAt (7.324667ms)
  ✔ saveWorkspace refuses to save a workspace that was never created (1.003708ms)
  ✔ listWorkspaces returns every workspace sorted by name, invalid ones included (9.097417ms)
  ✔ active-workspace pointer: get/set round-trip, and getActiveWorkspace resolves the full document (1.247042ms)
  ✔ setActiveWorkspaceName rejects an unknown workspace and accepts null to clear (1.021125ms)
  ✔ deleteWorkspace refuses to delete the active workspace unless forced (1.30525ms)
  ✔ renameWorkspace moves the directory, updates the document, and follows the active pointer (1.545833ms)
  ✔ cloneWorkspace copies configuration but never secrets or snapshot history (2.525291ms)
  ✔ searchWorkspaces matches name, tag, git email, and cloud reference (invalid workspaces excluded) (1.9475ms)
  ✔ switchToWorkspace applies git identity live, writes the shell-export file, and moves the active pointer (189.616041ms)
  ✔ switching workspaces re-applies git identity to match the newly-active one (299.840583ms)
  ✔ switchToWorkspace throws for an unknown workspace without moving the active pointer (93.482291ms)
  ✔ deactivateWorkspace clears the pointer and resets the shell-export file (104.405791ms)
  ✔ rollbackToSnapshot on the active workspace restores the document AND re-applies live state, with an automatic safety snapshot first (428.369333ms)
  ✔ rollbackToSnapshot on an inactive workspace only reverts the stored document, leaving live state untouched (119.525584ms)
  ℹ tests 1299
  ℹ suites 8
  ℹ pass 1299
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 228385.562459

  ```
  </details>


## 8. Release checklist and version consistency

See section 6 (`devforgekit doctor --release-check`) above - it is the single, authoritative source for: version consistency across VERSION/package.json/cli/package.json/Formula, required documentation present, distribution artifacts present, registry audit/lint/format clean, no outstanding pending-work markers, no experimental/debug flags enabled, a clean git working tree, and the current commit's own CI run conclusions.

