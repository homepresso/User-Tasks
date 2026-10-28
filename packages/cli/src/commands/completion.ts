/** `usertasks completion bash|zsh|fish`: static completion scripts built from the command tree. */

import type { Command } from 'commander'
import { CliUsageError } from '../exit-codes'
import type { Runtime } from '../runtime'

interface Node {
  name: string
  description: string
  options: string[]
  children: Node[]
}

function optionFlags(command: Command): string[] {
  return command.options.flatMap((option) => [option.short, option.long].filter((flag): flag is string => Boolean(flag)))
}

function toNode(command: Command): Node {
  return {
    name: command.name(),
    description: command.description(),
    options: optionFlags(command),
    children: command.commands.filter((child) => child.name() !== 'help').map(toNode),
  }
}

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export function bashScript(root: Node): string {
  const globals = root.options.join(' ')
  const cases: string[] = []
  for (const group of root.children) {
    const words = group.children.length ? group.children.map((c) => c.name) : group.options
    cases.push(`    ${group.name}) words=${shellQuote(words.join(' '))} ;;`)
    for (const leaf of group.children) {
      cases.push(`    "${group.name} ${leaf.name}") words=${shellQuote(leaf.options.join(' '))} ;;`)
    }
  }
  return `# usertasks bash completion. Install: usertasks completion bash > /etc/bash_completion.d/usertasks
# (or add \`source <(usertasks completion bash)\` to ~/.bashrc)
_usertasks() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" path="" i words
  for ((i = 1; i < COMP_CWORD; i++)); do
    case "\${COMP_WORDS[i]}" in -*) continue ;; esac
    path="\${path:+$path }\${COMP_WORDS[i]}"
  done
  case "$path" in
    "") words=${shellQuote(root.children.map((c) => c.name).join(' '))} ;;
${cases.join('\n')}
    *) words="" ;;
  esac
  COMPREPLY=($(compgen -W "$words ${globals}" -- "$cur"))
}
complete -o default -F _usertasks usertasks
`
}

export function zshScript(root: Node): string {
  return `#compdef usertasks
# usertasks zsh completion. Add \`source <(usertasks completion zsh)\` to ~/.zshrc
autoload -U +X bashcompinit && bashcompinit
${bashScript(root)}`
}

export function fishScript(root: Node): string {
  const lines = ['# usertasks fish completion. Install: usertasks completion fish > ~/.config/fish/completions/usertasks.fish', 'complete -c usertasks -f']
  const top = root.children.map((c) => c.name).join(' ')
  for (const option of root.options.filter((flag) => flag.startsWith('--'))) {
    lines.push(`complete -c usertasks -l ${option.slice(2)}`)
  }
  for (const group of root.children) {
    lines.push(`complete -c usertasks -n "not __fish_seen_subcommand_from ${top}" -a ${group.name} -d ${shellQuote(group.description)}`)
    const verbs = group.children.map((c) => c.name).join(' ')
    for (const leaf of group.children) {
      lines.push(`complete -c usertasks -n "__fish_seen_subcommand_from ${group.name}; and not __fish_seen_subcommand_from ${verbs}" -a ${leaf.name} -d ${shellQuote(leaf.description)}`)
      for (const option of leaf.options.filter((flag) => flag.startsWith('--'))) {
        lines.push(`complete -c usertasks -n "__fish_seen_subcommand_from ${group.name}; and __fish_seen_subcommand_from ${leaf.name}" -l ${option.slice(2)}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

export function registerCompletionCommand(program: Command, runtime: Runtime) {
  program
    .command('completion <shell>')
    .description('Print a shell completion script (bash, zsh or fish)')
    .action(async (shell: string) => {
      const root = toNode(program)
      const scripts: Record<string, (root: Node) => string> = { bash: bashScript, zsh: zshScript, fish: fishScript }
      const build = scripts[shell]
      if (!build) throw new CliUsageError(`Unsupported shell "${shell}" (expected bash, zsh or fish)`)
      runtime.io.stdout.write(build(root))
    })
}
