/** Fixed segments the server always includes: a standby card when there are no stories, and a sign-off. */

export const SIGNOFF = {
  id: 'signoff',
  kind: 'desk',
  tag: 'SIGN-OFF',
  headline: 'Check each source before you act',
  stat: { label: 'ON SCREEN', value: 'SOURCES', sub: 'EVERY STORY LINKS ITS SOURCE', dir: 'flat' },
  facts: [
    { k: 'SOURCES', v: 'LINKED', s: 'ok' },
    { k: 'NUMBERS', v: 'AS REPORTED', s: 'ok' },
    { k: 'ADVICE', v: 'NONE', s: 'ok' },
  ],
  source: {
    outlet: 'Purr & Bark desk',
    url: '',
    date: '',
    publishedAt: '',
    flag: 'Desk note',
    summary:
      'Every story links to its source and shows when it was published. Numbers are as reported, not live prices. An AI writes each script from the linked reports and software checks it, but mistakes can still get through. Nothing here is financial advice.',
  },
  also: [],
  lines: [
    ['lotti', 'That is the rundown for now. New stories land here every few minutes.'],
    ['bram', 'Every story names its source and shows when it was published. Open the links and read the original.'],
    ['lotti', 'And remember, an AI wrote this script from those reports, so double check everything.'],
    ['bram', 'Not financial advice. Verify before you act. We will be right back.'],
  ],
};

export const WARMUP = {
  id: 'warmup',
  kind: 'desk',
  tag: 'STANDBY',
  headline: 'Scanning the feeds for new stories',
  stat: { label: 'STATUS', value: 'SCANNING', sub: 'FIRST STORIES IN A MINUTE OR TWO', dir: 'flat' },
  facts: [
    { k: 'FEEDS', v: 'CHECKING', s: 'ok' },
    { k: 'STORIES', v: 'NONE YET', s: 'warn' },
    { k: 'ADVICE', v: 'NONE', s: 'ok' },
  ],
  source: {
    outlet: 'Purr & Bark desk',
    url: '',
    date: '',
    publishedAt: '',
    flag: 'Standby',
    summary: 'The desk is reading its news and market feeds. Stories appear here as soon as they pass the checks.',
  },
  also: [],
  lines: [
    ['lotti', 'We are scanning the feeds right now. The first stories should land in a minute or two.'],
    ['bram', 'Nothing has passed the filter yet. We would rather wait than make something up.'],
    ['lotti', 'Stay with us.'],
    ['bram', 'Not financial advice.'],
  ],
};
