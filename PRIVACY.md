# Privacy Policy for X-max Schedule Time

Effective date: August 20, 2026

X-max Schedule Time ("X-max") is a Chrome extension that applies a configured schedule time to X's native post composer. This policy explains what information X-max handles and how it handles that information.

## Information X-max handles

X-max handles only the information required for its scheduling function:

- Scheduling settings, including whether scheduling is enabled, the selected rule, delay or interval values, minimum lead time, and selected time zone.
- Schedule state, including the timestamp of the last schedule applied and whether the sequence was reset.
- The browser time zone, which is calculated locally by the browser.
- Schedule date and time values shown in X's rendered scheduling interface. X-max processes these values locally to operate the native schedule controls.
- The active tab URL, only to confirm that the shortcut is used on `x.com` or `twitter.com`.

X-max does not collect or store post text, account credentials, authentication tokens, cookies, private messages, browsing history, or private API responses.

## How X-max uses information

X-max uses the information above only to:

- Calculate a schedule time.
- Convert the configured rule time zone to the browser time zone used by X.
- Apply date and time values to X's native schedule controls.
- Continue or reset a sequential scheduling rule.
- Save the user's scheduling preferences.

All schedule calculations and interactions with X occur locally in the browser. X-max does not publish posts automatically.

## Storage and retention

X-max uses the Chrome `storage` permission.

- Scheduling preferences are stored with `chrome.storage.sync` when available. Chrome can synchronize this information through the user's browser profile. That synchronization is provided by Google and is subject to the user's Chrome and Google account settings.
- If sync storage is unavailable, X-max stores the preferences with `chrome.storage.local`.
- Sequence timestamps and reset state are stored locally when possible.

X-max retains this information until the user changes the settings, resets the sequence, clears the extension's storage, or uninstalls the extension. X-max does not operate a server and does not keep a separate copy of this information.

## Data transmission and sharing

X-max does not send user data to the developer, advertisers, analytics providers, or other third parties. It does not include analytics, advertising, tracking, telemetry, or remote logging.

X-max makes no network requests. Its interaction with X is limited to the rendered page interface in the user's browser.

## Sale and advertising

X-max does not sell user data. It does not use user data for advertising, credit decisions, or any purpose unrelated to its scheduling function.

## Chrome Web Store Limited Use

X-max's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Information is used only to provide the extension's single scheduling purpose. It is not transferred to third parties or used for personalized advertising, and no human reads it.

## Security

X-max minimizes data access by requesting only the `storage` permission and host access to `x.com` and `twitter.com`. Because X-max does not transmit user data, it does not expose user data through extension-operated network services.

## Changes to this policy

This policy can change if X-max's features or data practices change. Material changes will be documented in this file and reflected in the Chrome Web Store listing as required.

## Contact

For privacy questions or requests, open an issue in the [X-max GitHub repository](https://github.com/blepotan/x-max/issues).
