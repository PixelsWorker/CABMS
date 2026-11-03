/** SQL predicate for wm membership and its currently verified im Firebase mapping. */
export const approvedMembership = `(wm.role NOT IN ('super_admin', 'owner_admin') OR EXISTS (
  SELECT 1 FROM privileged_identity_approvals a
  WHERE a.user_id = wm.user_id AND a.workspace_id = wm.workspace_id AND a.role = wm.role
    AND a.provider_id = im.provider_id AND a.provider_subject_id = im.provider_subject_id AND a.revoked_at IS NULL
    AND (wm.role <> 'super_admin' OR EXISTS (
      SELECT 1 FROM g01_protected_super_admin p
      WHERE p.singleton = 1 AND p.user_id = wm.user_id AND p.provider_id = im.provider_id
        AND im.provider_subject_id = COALESCE((SELECT provider_subject_id FROM g01_effective_super_admin_uid), p.provider_subject_id)
    ))
))`;
