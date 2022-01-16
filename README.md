# pprof-it

`pprof-it` is a convenient wrapper to `pprof` that makes it easy to capture
CPU and memory profiles of node programs.

## Usage

To use `pprof-it`, you need to pass `--require pprof-it` to NodeJS.
Depending on how your program is run, this can be done one of a few ways:

```sh
# Directly running with node
$ node --require pprof-it path/to/script.js

# Executables via npm/npx (v7+)
$ npx --node-option="--require pprof-it" <executable name>
$ npm exec --node-option="--require pprof-it" <executable name>

# Executables via npm/npx (v6)
$ npx --node-arg="--require pprof-it" <executable name>

# yarn v1
$ ???

# yarn v2+
$ ???
```

## Options

By default, `pprof-it` will produce both heap and time profiles and
write them to the current directory. This behavior can be configured
via the following environment variables.

-   `PPROF_PROFILES`: Which profiles to run, separated by commas. The
    currently available profiles are `heap` and `time`. Defaults to `heap,time`.

-   `PPROF_OUT`: Where to write the profiles. Defaults to the
    current working directory.

-   `PPROF_LOGGING`: Controls `pprof-it`'s logging. May be `off` or `on`.
    Defaults to `on`.

-   `PPROF_HEAP_OUT`: Path to write the heap profile, to, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory.

-   `PPROF_HEAP_INTERVAL`: Average number of bytes between samples. Defaults to
    `512*1-24`.

-   `PPROF_HEAP_STACK_DEPTH`: Maximum stack depth for samples. Defaults to `64`.

-   `PPROF_TIME_OUT`: Path to write the time profile to, if enabled. If
    this path is relative, it will be relative to `PPROF_OUT`. If a directory,
    the profile will be placed in that directory.
