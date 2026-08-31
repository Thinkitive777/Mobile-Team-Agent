# Mobile Team Agent — Installation

## Option 1 — npm (recommended)

```bash
npm install -g mobile-team-agent
cd /path/to/your/project
mobile-team-agent setup          # or: npx mobile-team-agent setup
```

Always `cd` into your project before running `setup` — it writes a `CLAUDE.md`
into the current directory.

### Hitting `EACCES` / "permission denied" on the global install?

```
npm ERR!   syscall: 'mkdir',
npm ERR!   path: '/usr/local/lib/node_modules/mobile-team-agent'
npm ERR! The operation was rejected by your operating system.
```

Your global npm folder is owned by `root`. The clean fix — no `sudo`, one time only:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc   # ~/.zshrc on zsh
source ~/.bashrc
npm install -g mobile-team-agent
```

Alternatives (nvm, `chown`, `sudo`) and the full explanation are in
[README.md → Installation](README.md#npm-install--g-fails-with-eacces--permission-denied).

**Never run `setup` with `sudo`** — it writes to `~/.claude/` and would create
root-owned files that Claude CLI can't read.

## Option 2 — clone the repository

```bash
# step 1: clone
git clone https://github.com/Shekhar9398/Mobile-Team-Agent.git

# step 2: navigate to the project directory
cd Mobile-Team-Agent/"Mobile Team Agent"

# step 3: make the script executable and run it
chmod +x install.sh && ./install.sh
```

This route installs into `~/.mobile-team-agent/` and needs no root access.

**Requirements:** Node.js ≥ 18, Claude CLI installed.
