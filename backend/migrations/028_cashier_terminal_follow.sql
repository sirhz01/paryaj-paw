-- Caissiers liés à une caisse renommée ou supprimée : toute vente était refusée (« Caisse inconnue »).
-- On suit les renommages dans l'historique des réglages (même position, même nombre de caisses) ;
-- un lien qui ne mène à aucune caisse actuelle est retiré : le caissier choisit alors sa caisse,
-- et le propriétaire peut lui en attribuer une dans l'administration.
DO $$
DECLARE
  s RECORD;
  v RECORD;
  cur TEXT;
  cand TEXT;
  prev JSONB;
  latest JSONB;
BEGIN
  SELECT terminals INTO latest FROM shop_settings ORDER BY version DESC LIMIT 1;
  FOR s IN SELECT id, terminal FROM staff WHERE terminal IS NOT NULL LOOP
    cur := s.terminal;
    -- Nom saisi en minuscules avant l'enregistrement des réglages (toujours en majuscules).
    IF NOT EXISTS (SELECT 1 FROM shop_settings WHERE terminals ? cur) THEN cur := upper(btrim(cur)); END IF;
    prev := NULL;
    FOR v IN SELECT terminals FROM shop_settings ORDER BY version LOOP
      IF prev IS NOT NULL AND prev ? cur AND NOT v.terminals ? cur
         AND jsonb_array_length(prev) = jsonb_array_length(v.terminals) THEN
        SELECT v.terminals ->> (e.ord - 1)::int INTO cand
          FROM jsonb_array_elements_text(prev) WITH ORDINALITY AS e(val, ord) WHERE e.val = cur;
        IF cand IS NOT NULL AND NOT prev ? cand THEN cur := cand; END IF;
      END IF;
      prev := v.terminals;
    END LOOP;
    IF latest ? cur THEN
      UPDATE staff SET terminal = cur WHERE id = s.id AND terminal <> cur;
    ELSE
      UPDATE staff SET terminal = NULL WHERE id = s.id;
    END IF;
  END LOOP;
END $$;
