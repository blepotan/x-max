# X-max Schedule Time

<p>
  <a href="CHANGELOG.md"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/release-0.1.4-blue.svg?variant=outline&amp;mode=dark"><img alt="release 0.1.4" src="https://shieldcn.dev/badge/release-0.1.4-blue.svg?variant=outline&amp;mode=light"></picture></a>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/manifest-MV3-violet.svg?variant=outline&amp;mode=dark"><img alt="manifest MV3" src="https://shieldcn.dev/badge/manifest-MV3-violet.svg?variant=outline&amp;mode=light"></picture>
  <a href="https://bun.sh"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/runtime-Bun_1.3.14-orange.svg?variant=outline&amp;mode=dark"><img alt="runtime Bun 1.3.14" src="https://shieldcn.dev/badge/runtime-Bun_1.3.14-orange.svg?variant=outline&amp;mode=light"></picture></a>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/tests-43_passing-green.svg?variant=outline&amp;mode=dark"><img alt="tests 43 passing" src="https://shieldcn.dev/badge/tests-43_passing-green.svg?variant=outline&amp;mode=light"></picture>
  <a href="LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/license-MIT-green.svg?variant=outline&amp;mode=dark"><img alt="license MIT" src="https://shieldcn.dev/badge/license-MIT-green.svg?variant=outline&amp;mode=light"></picture></a>
</p>

X-max sets the schedule time for an X post. Press one keyboard shortcut to apply the configured rule. X-max uses the native X schedule controls.

X-max does not publish the post. Review the post and publish it when you are ready.

## Demo

<video src="docs/assets/schedule.mp4" controls muted width="720">
  Your browser cannot show this video. Use the demo link below.
</video>

[Open the demo video](docs/assets/schedule.mp4)

## Main functions

- Use a fixed delay from the current time.
- Use a sequential interval for a series of posts.
- Reset the sequence to the current time.
- Convert the rule time zone to the browser time zone that X uses.
- Open and operate the X schedule dialog in the background.
- Show the rule time and the converted X time.
- Configure the action with a Chrome keyboard shortcut.

## Install the extension

1. Download or clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Set **Developer mode** to on.
4. Click **Load unpacked**.
5. Select the repository directory.
6. Refresh each open X tab.

## Set the keyboard shortcut

1. Open `chrome://extensions/shortcuts`.
2. Find **X-max Schedule Time**.
3. Set a shortcut for **Set the next X post schedule time**.

The suggested shortcut is `Alt+Shift+X`.

## Configure a rule

Click the X-max icon in the Chrome toolbar. Select one scheduling rule.

### Fixed delay

Set the number of minutes after the current time. For example, set `60` to schedule the post one hour from now.

### Sequential interval

Set the interval between posts. X-max stores the time of the last schedule that it applied. The next shortcut adds one interval to that time.

The minimum lead time applies when the sequence starts from the current time.

Use **Reset to current time** to delete the stored sequence time. The next shortcut starts a new sequence from the current time.

## Time zones

The rule time zone controls the schedule calculation. X cannot change its time zone in the schedule dialog.

X-max converts the result to the browser time zone. It then writes the converted date and time to X.

The preview shows two values when the zones are different:

- **Rule time:** The time in the configured rule zone.
- **X time:** The equivalent time in the browser zone.

Use `local` to use the browser time zone for both values.

## Use X-max

1. Open an X post composer.
2. Write the post.
3. Press the X-max shortcut.
4. Wait for the confirmation notification.
5. Review the scheduled time in the composer.

## Privacy

X-max operates only on the rendered X interface. It does not use private X API endpoints.

X-max does not read these items:

- Cookies
- Authentication tokens
- Post text
- Private API responses

X-max does not make network requests.

## Development

The extension has no runtime dependencies. Use Bun 1.3.14 or a compatible later version for development.

Run the tests:

```sh
bun test
```

Check the JavaScript syntax:

```sh
bun run check
```

## Release information

See [CHANGELOG.md](CHANGELOG.md) for the changes in each release.

## License

This project uses the MIT License. See [LICENSE](LICENSE).
