# Job-Ops Levels.fyi Salary Helper (Chrome Extension)

Relays compensation ranges you view on `levels.fyi` back to your open local `job-ops` tab (`http://localhost:*` or `http://127.0.0.1:*`).

## Install (one-time)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extensions/levels-fyi-helper` folder.

## Usage

1. Open any job in `job-ops` that does not have a salary yet and click **Check salary on Levels.fyi**.
2. Levels.fyi opens in a popup window for that company and role.
3. Once the salary page loads, pick a detected salary chip (or edit the input) in the bottom-right **Send salary to Job-Ops** panel and click **Send to Job-Ops**.
4. `job-ops` saves the salary (`salary`, `salaryMinAmount`, `salaryMaxAmount`, `salaryCurrency`, `salaryInterval`, and `salarySource: "levels.fyi"`) using your current session.
