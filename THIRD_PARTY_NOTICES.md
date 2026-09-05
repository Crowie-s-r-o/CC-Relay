# Third-party notices

CC Relay bundles the following font files. Each font remains under the SIL Open Font License 1.1 rather than the CC Relay project license.

| Font | Bundled file | Copyright notice | License and source |
| --- | --- | --- | --- |
| Instrument Sans | `public/fonts/instrument-sans-latin.woff2` | Copyright 2022 The Instrument Sans Project Authors | [Bundled OFL text](public/fonts/licenses/Instrument-Sans-OFL.txt), [upstream project](https://github.com/Instrument/instrument-sans) |
| JetBrains Mono | `public/fonts/jetbrains-mono-latin.woff2` | Copyright 2020 The JetBrains Mono Project Authors | [Bundled OFL text](public/fonts/licenses/JetBrains-Mono-OFL.txt), [upstream project](https://github.com/JetBrains/JetBrainsMono) |
| Source Serif 4 | `public/fonts/source-serif-4-latin.woff2` | Copyright 2014 - 2023 Adobe, with Reserved Font Name `Source` | [Bundled OFL text](public/fonts/licenses/Source-Serif-OFL.txt), [upstream project](https://github.com/adobe-fonts/source-serif) |

The license files live under `public/fonts/licenses/` so they are present both in the source repository and in packaged desktop applications.

## Optional voice input components

Voice input is not bundled in the CC Relay installer. When the user explicitly chooses **Set up engine**, Relay uses `pip` inside an isolated application-data runtime and downloads the selected speech model. These components and their transitive dependencies remain governed by their own licenses.

| Component | Use | License and source |
| --- | --- | --- |
| faster-whisper 1.2.1 | Local CPU speech transcription | MIT, [upstream project](https://github.com/SYSTRAN/faster-whisper), [PyPI package](https://pypi.org/project/faster-whisper/1.2.1/) |
| Systran faster-whisper base model | Multilingual local speech model | MIT, [model repository](https://huggingface.co/Systran/faster-whisper-base) |

The isolated Python environment retains each installed distribution's package metadata. Removing Relay's application data removes this optional runtime and model cache.

## Launchpad interface fonts

- Space Grotesk: Copyright 2020 The Space Grotesk Project Authors. SIL Open Font License 1.1, bundled in `public/fonts/licenses/Space-Grotesk-OFL.txt`.
- IBM Plex Mono: Copyright 2017 IBM Corp., reserved font name Plex. SIL Open Font License 1.1, bundled in `public/fonts/licenses/IBM-Plex-Mono-OFL.txt`.

The unmodified Latin WOFF2 assets come from the supplied CC Relay Launchpad v2 design bundle. Both families load locally without a network dependency.
