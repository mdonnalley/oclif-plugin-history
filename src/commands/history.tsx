/* eslint-disable perfectionist/sort-jsx-props */
import {Select, TextInput, ThemeProvider, defaultTheme, extendTheme} from '@inkjs/ui'
import {Command, Interfaces} from '@oclif/core'
import {Ansis} from 'ansis'
import {Box, Text, type TextProps, render} from 'ink'
import {exec as cpExec} from 'node:child_process'
import {URL} from 'node:url'
import React, {Component} from 'react'
import {sort} from 'semver'
import terminalLink from 'terminal-link'
const ansis = new Ansis()

type NpmDetails = {
  date: string
  dependencies: Record<string, string>
  dist: {
    tarball: string
    unpackedSize: number
  }
  'dist-tags': Record<string, string>
  gitHead: string
  name: string
  oclif?: {
    plugins?: string[]
  }
  repository: {
    type: string
    url: string
  }
  time: Record<string, string>
  version: string
  versions: string[]
}

type VersionScrollerProps = {
  readonly config: Interfaces.Config
  readonly npmDetails: NpmDetails
}

async function exec(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cpExec(command, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}

function humanReadableLocaleDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    month: 'long',
    timeZoneName: 'short',
    weekday: 'short',
    year: 'numeric'
  })
}

function humanReadableUTCDate(date: string): string {
  return new Date(date).toUTCString()
}

function humanReadableShortDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {day: 'numeric', month: 'short', year: 'numeric'})
}

function formatPlugins(config: Interfaces.Config, plugins: Record<string, Interfaces.PluginVersionDetail>): string[] {
  const sorted = Object.entries(plugins)
    .map(([name, plugin]) => ({name, ...plugin}))
    .sort((a, b) => (a.name > b.name ? 1 : -1))

  return sorted.map((plugin) =>
    `${getFriendlyName(config, plugin.name)} ${ansis.dim(plugin.version)} ${ansis.dim(`(${plugin.type})`)} ${
      plugin.type === 'link' ? ansis.dim(plugin.root) : ''
    }`.trim(),
  )
}

function getFriendlyName(config: Interfaces.Config, name: string): string {
  const {scope} = config.pjson.oclif
  if (!scope) return name
  const match = name.match(`@${scope}/plugin-(.+)`)
  if (!match) return name
  return match[1]
}

function bytesToMB(bytes: number, decimalPlaces = 2): string {
  return `${Number.parseFloat((bytes / 1024 / 1024).toFixed(decimalPlaces))}mb`
}

const customTheme = extendTheme(defaultTheme, {
  components: {
    Select: {
      styles: {
        focusIndicator: (): TextProps => ({
          bold: true,
          color: 'cyan',
        }),
        label({isFocused, isSelected}): TextProps {
          if (isSelected) {
            return {bold: true, color: 'green'}
          }

          if (isFocused) {
            return {bold: true, color: 'cyan'}
          }

          return {
            color: undefined
          }
        },
      },
    },
  },
})

class VersionScroller extends Component<VersionScrollerProps> {
  public state = {
    display: 'Select a version or search for one in the input above',
    options: [],
    query: '',
    value: undefined as string | undefined,
  }

  private config: Interfaces.Config
  private npmDetails: NpmDetails
  private suggestions: string[]

  public constructor(props: VersionScrollerProps) {
    super(props)
    this.npmDetails = props.npmDetails
    this.config = props.config
    this.suggestions = this.npmDetails.versions
  }

  async componentDidMount() {
    this.setOptions()
  }

  public render() {
    return (
      <ThemeProvider theme={customTheme}>
        <Box flexDirection="column" gap={1}>
          <Box borderStyle="round" borderColor="cyan" padding={1}>
            <Text color='cyanBright'>Search: </Text>
            <TextInput placeholder='Start typing. Hit `enter` to autocomplete a suggestion.' suggestions={this.suggestions} onChange={(value) => {
              if (value !== this.state.query) {
                this.setState({query: value})
                this.setOptions(value)
              }
            }}/>
          </Box>

          <Select
            options={this.state.options}
            visibleOptionCount={20}
            onChange={async (value) => {
              if (this.state.value !== value) {
                this.setState({display: ansis.yellow('Loading...'), value})
                const npm = await exec(
                  `npm view ${this.config.name}@${value} --json --registry ${this.config.npmRegistry}`,
                )
                const parsed = JSON.parse(npm.toString()) as NpmDetails
                const plugins = value
                  ? Object.fromEntries(
                      parsed.oclif?.plugins?.map((p) => [p, {root: p, type: 'core', version: parsed.dependencies[p]}]) ??
                        [],
                    )
                  : undefined
                const {host, pathname} = new URL(parsed.repository.url)
                const normalizedUrl = `https://${host}${pathname.replace('.git', '')}`
                const display = value
                  ? `${ansis.bold.underline(`${this.config.bin}@${value}`)}
Locale publish date ${ansis.dim(humanReadableLocaleDate(parsed.time[value]))}
UTC publish date ${ansis.dim(humanReadableUTCDate(parsed.time[value]))}
Commit ${ansis.dim(terminalLink(parsed.gitHead.slice(0, 7), `${normalizedUrl}/commit/${parsed.gitHead}`))}
Tarball ${ansis.dim(terminalLink(parsed.dist.tarball, parsed.dist.tarball))}
Unpacked Size ${ansis.dim(bytesToMB(parsed.dist.unpackedSize))}
Plugins
  ${plugins ? formatPlugins(this.config, plugins).join('\n  ') : ''}`.trim()
                  : this.determineDefaultDisplayMessage(value)
                this.setState({display, value})
              }
            }}
          />
          <Box flexDirection="column" padding={1}>
            <Text>{this.state.display}</Text>
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  private determineDefaultDisplayMessage(value: string | undefined): string {
    if (this.state.query && !value) {
      return 'No versions found based on input'
    }

    return 'Select a version or search for one in the input above'
  }

  private setOptions(query?: string) {
    const options = sort(this.npmDetails.versions)
      .reverse()
      .filter((version) => checkIfMatchesQuery(query, version))
      .map((version) => ({
        label: `${version} ${ansis.dim(humanReadableShortDate(this.npmDetails.time[version]))}`,
        value: version,
      }))

    this.setState({options})
  }
}

function checkIfMatchesQuery(query: string | undefined, version: string): boolean {
  if (!query) return true
  if (Number.isNaN(Number(query))) return version.includes(query)
  return version.startsWith(query)
}

export default class History extends Command {
  static override description = 'Interactively explore the version history of <%= config.bin %>.'

  static override examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const result = await exec(`npm view ${this.config.name} --json --registry ${this.config.npmRegistry}`)
      const parsed = JSON.parse(result) as NpmDetails

      if (!parsed.oclif) {
        // note that this will not play nicely with CLIs that use an rc file since we're dependent on the oclif config being in the package.json
        // we might be able to get the plugins from this.config.plugins though and npm view those.
        this.error(`No oclif config found for ${this.config.name}`)
      }

      render(<VersionScroller config={this.config} npmDetails={parsed} />)
    } catch (error) {
      if (error instanceof Error || typeof error === 'string') {
        this.error(error)
      }

      this.error(`An unexpected error occurred. ${error}`)
    }
  }
}
