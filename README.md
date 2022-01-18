# pprof-it

`pprof-it` is a convenient wrapper to `pprof` that makes it easy to capture
CPU and memory profiles of node programs.

(Technically, `pprof-it` uses [DataDog's fork](https://github.com/datadog/pprof-nodejs)
of `pprof-node`, as it supports newer versions of node and includes prebuilds
for many more platforms.)

## Usage

To use `pprof-it`, install the package, then pass `--require pprof-it` to node
when executing your program. Depending on how your program is run, this can be
achieved one of a few ways:

```sh
# Directly running with node
$ node --require pprof-it path/to/script.js

# Executables via npm/npx (v7+)
$ npx --node-option="--require pprof-it" <executable name>
$ npm exec --node-option="--require pprof-it" <executable name>

# Executables via npm/npx (v6)
$ npx --node-arg="--require pprof-it" <executable name>

# Executables via yarn (usually)
$ node --require pprof-it $(yarn bin <executable name>)
```

The `NODE_OPTIONS` environment variable may be used to pass `--require`, but
is not recommended as more than one process may emit profiles.

By default, `pprof-it` will produce both heap and time profiles and
write them to the current directory.

To view the profiles, you can use [SpeedScope](https://www.speedscope.app/)
for a quick and easy view, or use the [`pprof` utility](https://github.com/google/pprof)
for more info, like:

```sh
# CLI interface
$ go run github.com/google/pprof@latest pprof-time-10503.pb.gz
# Browser interface
$ go run github.com/google/pprof@latest -http=: pprof-time-10503.pb.gz
```

## Options

`pprof-it`'s behavior can be configured via the following environment variables.

-   `PPROF_PROFILERS`: Which profilers to run, separated by commas. The
    currently available profilers are `heap` and `time`. Defaults to `heap,time`.

-   `PPROF_OUT`: Where to write the profiles. Defaults to the
    current working directory.

-   `PPROF_SANITIZE`: Enables sanitization of paths in output profiles.
    May be `off` or `on`. Defaults to `off`.

-   `PPROF_LINE_NUMBERS`: Attempts to collect line numbers. This option is
    documented as experimental upstream (but seems to work), and only works
    for time profiles. May be `off` or `on`. Defaults to `on`.

-   `PPROF_HEAP_OUT`: Output path for the heap profile, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory with the default name.
    Defaults to `pprof-heap-${process.id}.pb.gz`.

-   `PPROF_HEAP_INTERVAL`: Average number of bytes between heap samples.
    Defaults to `512*1024`.

-   `PPROF_HEAP_STACK_DEPTH`: Maximum stack depth for heap samples.
    Defaults to `64`.

-   `PPROF_TIME_OUT`: Output path for the time profile, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory with the default name.
    Defaults to `pprof-time-${process.id}.pb.gz`.

-   `PPROF_TIME_INTERVAL`: Average number of microsoeconds between time samples.
    Defaults to `1000`.

-   `PPROF_SIGNAL_EXIT`: Enables handling of exit signals (e.g., SIGINT).
    May be `off` or `on`. Since signals are handled asynchronously,
    `pprof-it`'s registration of signal handlers may prevent exiting (as node
    will no longer attempt to interrupt normal code execution, e.g. quitting
    on Ctrl+C). Defaults to `on`.

-   `PPROF_LOGGING`: Controls `pprof-it`'s logging. May be `off` or `on`.
    Defaults to `on`.

On Windows, where setting environment variables temporarily is less convenient,
it's simplest to just use `cross-env` to handle this:

```ps1
$ npx cross-env PPROF_OUT=C:\foo\bar node --require pprof-it path\to\script.js
```
