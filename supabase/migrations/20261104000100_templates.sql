-- Replace all templates: 4 steps x 3 message types. Same content as supabase/seed.sql.

insert into public.message_templates (key, version, status, audience, title, body) values

-- Invites (sent from warmed_up)
('invite_label', 'A', 'warmed_up', 'label', 'Invite: label',
$$Hi {First}, I run TikTok fan-page campaigns for indie artists and {Company}'s roster keeps coming up in my research, {Artist} especially. Would be good to connect.$$),
('invite_label', 'B', 'warmed_up', 'label', 'Invite: label (no note)', ''),
('invite_management', 'A', 'warmed_up', 'management', 'Invite: management',
$$Hi {First}, I build faceless TikTok fan pages for artists who'd rather not live on camera. Saw you work with {Artist}. Would be good to connect.$$),
('invite_management', 'B', 'warmed_up', 'management', 'Invite: management (no note)', ''),
('invite_agency', 'A', 'warmed_up', 'agency', 'Invite: agency',
$$Hi {First}, I run TikTok fan-page campaigns for artists and partner with agencies that want to offer it to their own clients. Would be good to connect.$$),
('invite_agency', 'B', 'warmed_up', 'agency', 'Invite: agency (no note)', ''),

-- Message 1 (sent from connected)
('msg1_label', 'A', 'connected', 'label', 'Message 1: label',
$$Thanks for connecting, {First}.

Benson Boone, sombr and Laufey all have fan pages posting their songs every day. That's where a lot of discovery on TikTok happens now.

I put together a fan-page plan for {Artist}: the pages, who each one targets, plus 3 sample edits for '{Song}'. Want me to send it?$$),
('msg1_management', 'A', 'connected', 'management', 'Message 1: management',
$$Thanks {First}. Honest question: how many of your artists actually enjoy making TikToks?

Most I talk to don't. So we do it faceless: fan pages built around the song, zero time on camera.

I put together a fan-page plan for {Artist}, plus 3 sample edits for '{Song}'. Want it?$$),
('msg1_agency', 'A', 'connected', 'agency', 'Message 1: agency',
$$Thanks {First}. Quick one: do you offer TikTok fan pages to your artists?

I put together a sample fan-page plan and 3 edits for an example artist, so you can see exactly what your clients would get. Want me to send it?$$),

-- Follow-up nudge (sent from message_1_sent)
('followup_label', 'A', 'message_1_sent', 'label', 'Follow-up: label',
$${First}, still happy to send the plan and edits for {Artist}. Just say yes and they're yours.$$),
('followup_management', 'A', 'message_1_sent', 'management', 'Follow-up: management',
$${First}, still happy to send the plan and edits for {Artist}. Just say yes and they're yours.$$),
('followup_agency', 'A', 'message_1_sent', 'agency', 'Follow-up: agency',
$${First}, the offer stands: a sample plan and 3 edits, so you can see what your clients would get. Worth a look?$$),

-- Breakup (sent from follow_up_sent)
('breakup_label', 'A', 'follow_up_sent', 'label', 'Breakup: label',
$$Last one from me, {First}. Is TikTok for your artists something you look after, or is it someone else on the team?

Happy to get out of your inbox either way.$$),
('breakup_management', 'A', 'follow_up_sent', 'management', 'Breakup: management',
$$Last one from me, {First}. Is TikTok for your artists something you look after, or is it someone else on the team?

Happy to get out of your inbox either way.$$),
('breakup_agency', 'A', 'follow_up_sent', 'agency', 'Breakup: agency',
$$Last one from me, {First}. Is this something you'd want to offer clients, or not a fit right now?

Either answer helps, and I'll get out of your inbox.$$)

on conflict (key, version) do nothing;
