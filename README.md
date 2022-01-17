# pprof-it

`pprof-it` is a convenient wrapper to `pprof` that makes it easy to capture
CPU and memory profiles of node programs.

(Technically, `pprof-it` uses [DataDog's fork](https://github.com/datadog/pprof-nodejs)
of `pprof-node`, as it supports newer versions of node and includes prebuilds
for many more platforms).

## Usage

To use `pprof-it`, you need to pass `--require pprof-it` to node.
Depending on how your program is run, this can be done one of a few ways:

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

To view the profiles, you can use [SpeedScope](https://www.speedscope.app/)
for a quick and easy view, or use the [`pprof` utility](https://github.com/google/pprof)
for more info, like:

```sh
# CLI interface
$ pprof pprof-time-10503.pb.gz
# Browser interface
$ pprof -http=: pprof-time-10503.pb.gz
```

## Options

By default, `pprof-it` will produce both heap and time profiles and
write them to the current directory. `pprof-it`'s behavior can be
configured via the following environment variables.

-   `PPROF_PROFILES`: Which profiles to run, separated by commas. The
    currently available profiles are `heap` and `time`. Defaults to `heap,time`.

-   `PPROF_OUT`: Where to write the profiles. Defaults to the
    current working directory.

-   `PPROF_LOGGING`: Controls `pprof-it`'s logging. May be `off` or `on`.
    Defaults to `on`.

-   `PPROF_HEAP_OUT`: Output path for the heap profile, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory with the default name.
    Defaults to `pprof-heap-${process.id}.pb.gz`.

-   `PPROF_HEAP_INTERVAL`: Average number of bytes between heap samples
    Defaults to `512*1024`.

-   `PPROF_HEAP_STACK_DEPTH`: Maximum stack depth for heap samples.
    Defaults to `64`.

-   `PPROF_TIME_OUT`: Output path for the time profile, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory with the default name.
    Defaults to `pprof-time-${process.id}.pb.gz`.
