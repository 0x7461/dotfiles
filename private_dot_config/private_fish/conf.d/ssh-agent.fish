# Adopt the niri-spawned ssh-agent when the session didn't inherit it.
#
# niri sets SSH_AUTH_SOCK in its environment{} block, so every shell it spawns
# finds the agent. An SSH login is not a niri child and inherits nothing — the
# symptom is `ssh-add` reporting "Could not open a connection to your
# authentication agent" over SSH while local terminals work fine. The reflex
# then is `eval (ssh-agent)`, which starts a *second* agent on a random socket:
# the key lands somewhere only that session can see, and the agent outlives the
# logout holding an unlocked key (one leaked per connection).
#
# Safe to run unconditionally: it only ever points at a socket niri already
# created, never starts an agent, and defers to an inherited value.
#
# NOT in config.fish's `status is-interactive` block on purpose — `ssh host
# <cmd>` runs a non-interactive shell and needs the agent too.
#
# This does NOT ssh-add: an auto-add here was tried and reverted 2026-06-05
# because it prompts for the passphrase on every shell start. Priming the agent
# stays a once-per-boot manual step (see obsidian-vault/system/ssh-agent.md).
if not set -q SSH_AUTH_SOCK; and test -S /run/user/(id -u)/ssh-agent.sock
    set -gx SSH_AUTH_SOCK /run/user/(id -u)/ssh-agent.sock
end
