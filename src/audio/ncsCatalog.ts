export type NcsTrack = {
  title: string;
  artists: string[];
  genre: string;
  pageUrl: string;
  credit: string;
};

export const NCS_TRACKS: NcsTrack[] = [
  {
    title: "FAVELA",
    artists: ["MXZI", "Deno"],
    genre: "Brazilian Phonk",
    pageUrl: "https://ncs.io/",
    credit: "Music provided by NoCopyrightSounds. Track: MXZI, Deno - FAVELA. Free download/stream: https://ncs.io/",
  },
  {
    title: "SET ME FREE",
    artists: ["Sano"],
    genre: "Drum & Bass",
    pageUrl: "https://ncs.io/",
    credit: "Music provided by NoCopyrightSounds. Track: Sano - SET ME FREE. Free download/stream: https://ncs.io/",
  },
  {
    title: "FALLEN ANGEL",
    artists: ["NAVARA"],
    genre: "House",
    pageUrl: "https://ncs.io/",
    credit: "Music provided by NoCopyrightSounds. Track: NAVARA - FALLEN ANGEL. Free download/stream: https://ncs.io/",
  },
];

export const NCS_USAGE_POLICY_URL = "https://ncs.io/usage-policy";
