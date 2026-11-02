# Windows & Git Bash Setup

Run all commands in Git Bash (e.g. the VS Code terminal).

## 1. GitHub CLI (`gh`)

```bash
# Install GitHub CLI via winget
winget install --id GitHub.cli

# Add gh to the Git Bash PATH and reload the shell config
echo 'export PATH="$PATH:/c/Program Files/GitHub CLI"' >> ~/.bashrc
source ~/.bashrc

# Verify installation
gh --version

# Authenticate via web browser, then confirm
gh auth login
gh auth status
```

## 2. Node.js (via `fnm`)

```bash
# Install fnm (Fast Node Manager)
winget install Schniz.fnm
```

Close and reopen the terminal so `fnm` is on the PATH. Verify with `fnm --version`.

```bash
# Make fnm load automatically in every Git Bash session
echo 'eval "$(fnm env --use-on-cd --shell bash)"' >> ~/.bashrc
source ~/.bashrc

# Install Node.js 26 (LTS) and make it the default
fnm install 26
fnm default 26
fnm use 26

# Verify
node -v   # v26.x
npm -v    # 11.x
```

To pin the version per project, run `echo 26 > .nvmrc` in the repo root (`node -v > .nvmrc` fails in Git Bash with "stdout is not a tty"). With `--use-on-cd`, `fnm` will switch to it automatically.

## 3. Per-Repo vs. Global Settings

These files only apply to the repo or workspace they sit in. This repo already has them. For other repos, copy them or set the global equivalent.

| Setting | This repo | Global equivalent |
|---|---|---|
| LF line endings | `.gitattributes` (`* text=auto eol=lf`) | `git config --global core.autocrlf input` |
| VS Code terminal right-click paste/copy | `.vscode/settings.json` (`"terminal.integrated.rightClickBehavior": "default"`) | VS Code settings (`Ctrl+,`), search "terminal right click", set to `default` |
