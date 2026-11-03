-- Message templates. Re-running is safe: existing (key, version) rows are left alone,
-- so edits made in the dashboard are never overwritten.
-- Placeholders: {First} {Company} {Artist} {Song} {date} {N} {hookLine} {Samples}
-- [SQUARE BRACKET] notes block Copy until replaced. Replace [DECK LINK] and
-- [CALENDAR LINK] once in the dashboard; they are the same for every lead.

insert into public.message_templates (key, version, status, audience, reply_type, title, body) values

-- Invites (sent from warmed_up). Version B = empty body = connection request without a note.
('invite_label', 'A', 'warmed_up', 'label', null, 'Invite: label',
$$Hi {First}, I run TikTok fan-page campaigns for indie artists and {Company}'s roster keeps coming up in my research, {Artist} especially. Would be good to connect.$$),
('invite_label', 'B', 'warmed_up', 'label', null, 'Invite: label (no note)', ''),

('invite_release', 'A', 'warmed_up', 'release', null, 'Invite: release',
$$Hi {First}, saw {Artist} has '{Song}' coming on {date}. I work on the TikTok side of releases like that. Would be good to connect before it drops.$$),
('invite_release', 'B', 'warmed_up', 'release', null, 'Invite: release (no note)', ''),

('invite_manager', 'A', 'warmed_up', 'manager', null, 'Invite: manager',
$$Hi {First}, I build faceless TikTok fan pages for artists who'd rather not live on camera. Saw you manage {Artist}. Would be good to connect.$$),
('invite_manager', 'B', 'warmed_up', 'manager', null, 'Invite: manager (no note)', ''),

-- Message 1 (sent from connected)
('msg1_label', 'A', 'connected', 'label', null, 'Message 1: label',
$$Thanks for connecting, {First}.

Had a look at {Artist}'s TikTok. The sound for '{Song}' has {N} videos on it, and most are from the official account.

Benson Boone, sombr and Laufey all have fan pages posting their songs daily.

I cut 3 fan-page edits for '{Song}' to show what that'd look like. Want me to send them?$$),
('msg1_label', 'B', 'connected', 'label', null, 'Message 1: label (short)',
$$Thanks {First}. I made 3 TikTok fan-page edits for {Artist}'s '{Song}', the way Benson Boone's and sombr's fan pages post every day.

Want them?$$),

('msg1_release', 'A', 'connected', 'release', null, 'Message 1: release',
$$Thanks {First}. '{Song}' is out {date}, right?

Fan pages need [WARM-UP TIME] of warm-up before they can post, so for this one the window to start is pretty much now.

I cut 3 edits for '{Song}' in the aesthetics I'd test for it. Worth sending over?$$),
('msg1_release', 'B', 'connected', 'release', null, 'Message 1: release (short)',
$$Thanks {First}. If '{Song}' is out {date}, fan pages would need to start about now.

I made 3 edits for it. Want to see them?$$),

('msg1_manager', 'A', 'connected', 'manager', null, 'Message 1: manager',
$$Thanks {First}. Honest question: how many of your artists actually enjoy making TikToks?

Most I talk to hate it. So we do it faceless: pages built around the song, zero time on camera.

Made 3 edits for {Artist}'s '{Song}' to show what I mean. Want them?$$),
('msg1_manager', 'B', 'connected', 'manager', null, 'Message 1: manager (short)',
$$Thanks {First}. Made 3 faceless fan-page edits for {Artist}'s '{Song}'. Zero time on camera for {Artist}.

Want them?$$),

-- Follow-ups
('voice', 'A', 'message_1_sent', null, null, 'Voice note script',
$$Hey {First}, Andrej here, putting a voice to the text. I had '{Song}' on this morning, and the '{hookLine}' part is honestly a perfect fan-page hook. I cut a few edits around it. If you want them, just say yes. Cheers.$$),

('followup_samples', 'A', 'follow_up_1_sent', null, null, 'Follow-up: samples anyway',
$$Made these anyway, they're yours: {Samples}

Post them wherever. If one lands, you know where I am.$$),

('breakup', 'A', 'follow_up_2_sent', null, null, 'Breakup',
$$Last one from me, {First}. Is TikTok for your artists something you look after, or is it someone else on the team or an agency?

Happy to get out of your inbox either way.$$),

('samples_nudge', 'A', 'samples_sent', null, null, 'Samples nudge',
$$Curious which one you'd pick for {Artist}. I'd go with #2.$$),

-- Replies (sent from replied, matched on reply_type)
('reply_yes_send', 'A', 'replied', null, 'yes_send', 'Reply: yes, send',
$$Here you go: {Samples}

Rough cuts. On a real campaign we test several aesthetics and double down on whatever hits.

Which one feels closest to {Artist}?$$),

('reply_what_is_this', 'A', 'replied', null, 'what_is_this', 'Reply: what is this?',
$$Faceless TikTok pages posting edits of the song daily, each page aimed at a different audience. Easier to show than explain. Want the 3 edits?$$),

('reply_send_info', 'A', 'replied', null, 'send_info', 'Reply: send info',
$$Here's the deck: [DECK LINK]

Which artist would you test this on first?$$),

('reply_how_much', 'A', 'replied', null, 'how_much', 'Reply: how much?',
$$Packages run from $595/mo for 2 pages to $4k+ for a roster, 3-month minimum. Want to see the edits first?$$),

('reply_bots', 'A', 'replied', null, 'bots', 'Reply: is this bots?',
$$No. Real accounts run by real people, posting edits of the song. We never touch streams. Spotify's artificial-streaming rules are exactly why. Want me to send 3 edits so you can see?$$),

('reply_in_house', 'A', 'replied', null, 'in_house', 'Reply: we do it in-house',
$$Nice. How many pages per artist? Most in-house teams run 1–2. The effect comes from many niche pages. We can run alongside as extra pages.$$),

('reply_has_agency', 'A', 'replied', null, 'has_agency', 'Reply: we have an agency',
$$Who? Happy to run a side-by-side on one artist: same budget, compare listeners after 90 days.$$),

('reply_not_now', 'A', 'replied', null, 'not_now', 'Reply: not now',
$$Fair. When's the next release you'd care about?$$),

('reply_not_interested', 'A', 'replied', null, 'not_interested', 'Reply: not interested',
$$All good, thanks for telling me. Good luck with {Artist}.$$),

('reply_picks_one', 'A', 'replied', null, 'picks_one', 'Reply: picks one',
$$Same pick as me. Want me to show you how this would run around '{Song}'? 20 min this week or next: [CALENDAR LINK]$$),

('reply_not_our_vibe', 'A', 'replied', null, 'not_our_vibe', 'Reply: not our vibe',
$$Fair. What's {Artist}'s audience in your head: sad late-night, gym, nostalgic? I'll recut one.$$)

on conflict (key, version) do nothing;
