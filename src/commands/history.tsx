/* eslint-disable perfectionist/sort-jsx-props */
import {Select, TextInput, ThemeProvider, defaultTheme, extendTheme} from '@inkjs/ui'
import {Command, Interfaces} from '@oclif/core'
import {Ansis} from 'ansis'
import {Box, type Key, Text, type TextProps, render, useInput} from 'ink'
import {exec as cpExec} from 'node:child_process'
import {URL} from 'node:url'
import React, {useState} from 'react'
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
  engines: {
    node: string
  }
  gitHead: string
  name: string
  oclif?: {
    jitPlugins?: Record<string, string>
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

function formatPlugins(config: Interfaces.Config, plugins: Record<string, string>): string[] {
  const sorted = Object.entries(plugins)
    .map(([name, version]) => ({name, version}))
    .sort((a, b) => (a.name > b.name ? 1 : -1))

  return sorted.map((plugin) =>
    `${getFriendlyName(config, plugin.name)} ${ansis.dim(plugin.version)}`.trim(),
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

function normalizeGitUrl(url: string): string {
  const {host, pathname} = new URL(url)
  return `https://${host}${pathname.replace('.git', '')}`

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

function VersionScroller({config, npmDetails}: VersionScrollerProps) {
  const {time, versions} = npmDetails
  const makeOptions = (options: string[]) => sort(options).reverse().map((version) => ({
    label: `${version} ${ansis.dim(humanReadableShortDate(time[version]))}`,
    value: version,
  }))


  const [state, setState] = useState({
    activeComponent: 'search' as 'search' | 'select',
    activeDisplay: 'truncatedDisplay' as 'fullDisplay' | 'truncatedDisplay',
    fullDisplay: 'Select a version or search for one in the input above',
    options: makeOptions(versions),
    query: undefined as string | undefined,
    selected: undefined as string | undefined,
    truncatedDisplay: 'Select a version or search for one in the input above'
  })

  useInput((_, key) => {
    const allFalse = Object.values(key).every((value) => !value)
    if (allFalse) return 'search'

    if (key.shift && key.rightArrow) {
      setState({...state, activeDisplay: 'fullDisplay'})
      return
    }

    if (key.shift && key.leftArrow) {
      setState({...state, activeDisplay: 'truncatedDisplay'})
      return
    }

    const keysForSelect = ['downArrow', 'upArrow'] satisfies Array<keyof Key>
    const keysForSearch = ['rightArrow', 'leftArrow', 'escape', 'delete', 'backspace'] satisfies Array<keyof Key>

    if (keysForSelect.some((k) => key[k])) {
      setState({...state, activeComponent: 'select'})
      return
    }

    if (keysForSearch.some((k) => key[k])) {
      setState({...state, activeComponent: 'search'})
    }
  })

  const updateDisplay = async (selected: string) => {
    if (state.selected !== selected) {
      setState({...state, selected, truncatedDisplay: ansis.yellow('Loading...')})
      const npm = await exec(
        `npm view ${config.name}@${selected} --json --registry ${config.npmRegistry}`,
      )
      const parsed = JSON.parse(npm.toString()) as NpmDetails
      const plugins = selected
        ? Object.fromEntries(
            parsed.oclif?.plugins?.map((p) => [p, parsed.dependencies[p]]) ??
              [],
          )
        : undefined

      const dependencies = Object.entries(parsed.dependencies).filter(([dep]) => !parsed.oclif?.plugins?.includes(dep)).map(([dep, version]) => `${dep} ${ansis.dim(version)}`)
      const jitPlugins = Object.entries(parsed.oclif?.jitPlugins ?? []).map(([dep, version]) => `${dep} ${ansis.dim(version)}`)

      const base = selected
        ? `${ansis.bold.underline(`${parsed.name}@${selected}`)}
Locale publish date ${ansis.dim(humanReadableLocaleDate(parsed.time[selected]))}
UTC publish date ${ansis.dim(humanReadableUTCDate(parsed.time[selected]))}
Commit ${ansis.dim(terminalLink(parsed.gitHead.slice(0, 7), `${normalizeGitUrl(parsed.repository.url)}/commit/${parsed.gitHead}`))}
Tarball ${ansis.dim(terminalLink(parsed.dist.tarball, parsed.dist.tarball))}
Unpacked Size ${ansis.dim(bytesToMB(parsed.dist.unpackedSize))}
Plugins
  ${plugins ? formatPlugins(config, plugins).join('\n  ') : ''}`.trim()
        : 'Select a version or search for one in the input above'


      const fullDisplay = selected ? `${base}
JIT Plugins
  ${jitPlugins.join('\n  ')}
Non-plugin Dependencies
  ${dependencies.join('\n  ')}
Engines
  Node ${ansis.dim(parsed.engines.node)}

${ansis.green('Press shift + left arrow to exit full view')}` : 'Select a version or search for one in the input above'

      const truncatedDisplay = `${base}\n\n${ansis.green('Press shift + right arrow to enter full view')}`
      setState({...state, activeDisplay: 'truncatedDisplay', fullDisplay, selected, truncatedDisplay})
    }
  }

  const handleSearchSubmit = () => {
    setState({...state, activeComponent: 'select'})
  }

  const handleSearchChange = (query: string) => {
    if (query !== state.query) {
      const options = makeOptions(versions.filter((version) => checkIfMatchesQuery(query, version)))
      setState({
        ...state,
        options,
        query,
        ...(query && options.length === 0 ? {truncatedDisplay: 'No versions found based on input'} : {})
      })
    }
  }

  return (
    <ThemeProvider theme={customTheme}>
      <Box flexDirection='column' gap={1}>
        <Box flexDirection='row'>
          <Box paddingTop={1} paddingBottom={1}>
            <Text color='cyanBright'>Search: </Text>
          </Box>
          <Box borderStyle='round' borderColor='cyan' width='90%'>
            <TextInput
              isDisabled={state.activeComponent !== 'search'}
              placeholder='Start typing. Hit `enter` to autocomplete a suggestion.'
              suggestions={versions}
              onSubmit={handleSearchSubmit}
              onChange={handleSearchChange}/>
          </Box>
        </Box>

        <Box flexDirection='row'>
          <Box width='25%'>
            <Select
              isDisabled={state.activeComponent !== 'select'}
              options={state.options}
              visibleOptionCount={20}
              onChange={updateDisplay}
            />
          </Box>
          <Box width='75%'>
            <Text>{state[state.activeDisplay]}</Text>
          </Box>
        </Box>
    </Box>
  </ThemeProvider>
  )
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
