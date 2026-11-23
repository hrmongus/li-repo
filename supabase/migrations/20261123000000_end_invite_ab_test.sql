-- End the invite A/B test (A = note, B = no note). A won (16% vs 8% accepted, 6 vs 1 replies).
-- Every invite now uses A. Past sends keep their version in activity (text_sent, version).
delete from public.message_templates
where key in ('invite_label', 'invite_management', 'invite_agency') and version = 'B';
