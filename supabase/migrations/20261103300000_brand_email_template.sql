-- Brand: the default email template seeded for every workspace moves from the
-- old teal "usertasks" header to the new brand (ink / cream / bronze, the
-- flow-u mark served from {{app_url}}/brand/mark-192.png, "user"+"tasks"
-- wordmark as text). Email-safe table layout with a prefers-color-scheme
-- dark variant. Same name, description, subject, text body and placeholders
-- ({{user_task_title}}, {{user_task_description}}, {{user_task_id}},
-- {{app_url}}) as before, so workflows render the same content.
--
-- 1. New workspaces: create_default_email_template_for_tenant() seeds the new
--    HTML (trigger tenants_create_default_email_template is unchanged).
-- 2. Existing workspaces: the default template is replaced ONLY while it is
--    still byte-for-byte one of the three historical untouched defaults
--      a. 20260721 backfill (full layout, gradient header),
--      b. 20260722 backfill (full layout, solid header),
--      c. the trigger's compact layout (20260721/20260722/baseline),
--    with one of the two historical text bodies (20260721 wrote a literal
--    "\n"; 20260722 onwards real newlines). Any edited template is left alone.
--    The text body is normalised to the real-newline version.
-- Re-running is a no-op: updated rows no longer match the old strings.

CREATE OR REPLACE FUNCTION public.create_default_email_template_for_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO email_templates (
    tenant_id, name, description, subject, html_body, text_body, is_default
  ) VALUES (
    NEW.id,
    'UserTasks Default',
    'A polished UserTasks-branded email for workflow messages and task assignments.',
    'Action needed: {{user_task_title}}',
    $tpl$<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ut-page { background-color: #0E0D0A !important; }
    .ut-card { background-color: #1E1C17 !important; border-color: #2E2B24 !important; }
    .ut-title { color: #FAF8F3 !important; }
    .ut-body { color: #CFC8BA !important; }
    .ut-pill { background-color: #2E281D !important; color: #C7A575 !important; }
    .ut-button { background-color: #C7A575 !important; }
    .ut-button a { color: #17150F !important; }
    .ut-foot { color: #8F887A !important; border-color: #2E2B24 !important; }
    .ut-foot a { color: #C7A575 !important; }
  }
</style>
</head>
<body class="ut-page" style="margin:0;padding:0;background-color:#FAF8F3;">
<table role="presentation" class="ut-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FAF8F3" style="background-color:#FAF8F3;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" class="ut-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E8E2D6;border-radius:16px;border-collapse:separate;overflow:hidden;">
        <tr>
          <td bgcolor="#17150F" style="background-color:#17150F;padding:20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:6px;"><img src="{{app_url}}/brand/mark-192.png" width="36" height="36" alt="UserTasks logo" style="display:block;width:36px;height:36px;border:0;border-radius:8px;color:#FAF8F3;font-family:Arial,sans-serif;font-size:10px;"></td>
                <td style="vertical-align:middle;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.4px;color:#FAF8F3;">user<span style="color:#C7A575;">tasks</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 30px;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
            <span class="ut-pill" style="display:inline-block;padding:5px 10px;border-radius:999px;background-color:#F3ECDF;color:#977443;font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">Action required</span>
            <h1 class="ut-title" style="margin:18px 0 10px;font-size:24px;line-height:1.3;font-weight:700;color:#17150F;">{{user_task_title}}</h1>
            <p class="ut-body" style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#5C564C;">{{user_task_description}}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="ut-button" bgcolor="#17150F" style="background-color:#17150F;border-radius:10px;"><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:700;color:#FAF8F3;text-decoration:none;border-radius:10px;">Open task</a></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="ut-foot" style="padding:18px 28px;border-top:1px solid #EFEAE0;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8A8376;">Sent by a UserTasks workflow. If the button does not work, copy this link into your browser:<br><a href="{{app_url}}/tasks/{{user_task_id}}" style="color:#977443;text-decoration:underline;word-break:break-all;">{{app_url}}/tasks/{{user_task_id}}</a></td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$tpl$,
    E'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.',
    true
  );
  RETURN NEW;
END $fn$;

UPDATE public.email_templates
   SET html_body = $tpl$<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ut-page { background-color: #0E0D0A !important; }
    .ut-card { background-color: #1E1C17 !important; border-color: #2E2B24 !important; }
    .ut-title { color: #FAF8F3 !important; }
    .ut-body { color: #CFC8BA !important; }
    .ut-pill { background-color: #2E281D !important; color: #C7A575 !important; }
    .ut-button { background-color: #C7A575 !important; }
    .ut-button a { color: #17150F !important; }
    .ut-foot { color: #8F887A !important; border-color: #2E2B24 !important; }
    .ut-foot a { color: #C7A575 !important; }
  }
</style>
</head>
<body class="ut-page" style="margin:0;padding:0;background-color:#FAF8F3;">
<table role="presentation" class="ut-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FAF8F3" style="background-color:#FAF8F3;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" class="ut-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E8E2D6;border-radius:16px;border-collapse:separate;overflow:hidden;">
        <tr>
          <td bgcolor="#17150F" style="background-color:#17150F;padding:20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:6px;"><img src="{{app_url}}/brand/mark-192.png" width="36" height="36" alt="UserTasks logo" style="display:block;width:36px;height:36px;border:0;border-radius:8px;color:#FAF8F3;font-family:Arial,sans-serif;font-size:10px;"></td>
                <td style="vertical-align:middle;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.4px;color:#FAF8F3;">user<span style="color:#C7A575;">tasks</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 30px;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
            <span class="ut-pill" style="display:inline-block;padding:5px 10px;border-radius:999px;background-color:#F3ECDF;color:#977443;font-size:11px;font-weight:700;letter-spacing:0.7px;text-transform:uppercase;">Action required</span>
            <h1 class="ut-title" style="margin:18px 0 10px;font-size:24px;line-height:1.3;font-weight:700;color:#17150F;">{{user_task_title}}</h1>
            <p class="ut-body" style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#5C564C;">{{user_task_description}}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="ut-button" bgcolor="#17150F" style="background-color:#17150F;border-radius:10px;"><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:700;color:#FAF8F3;text-decoration:none;border-radius:10px;">Open task</a></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="ut-foot" style="padding:18px 28px;border-top:1px solid #EFEAE0;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8A8376;">Sent by a UserTasks workflow. If the button does not work, copy this link into your browser:<br><a href="{{app_url}}/tasks/{{user_task_id}}" style="color:#977443;text-decoration:underline;word-break:break-all;">{{app_url}}/tasks/{{user_task_id}}</a></td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>$tpl$,
       text_body = E'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.',
       updated_at = now()
 WHERE is_default
   AND html_body IN (
     -- a. 20260721 backfill
     '<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Inter,Arial,sans-serif;color:#17212b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,118,110,.10)"><tr><td style="padding:24px 30px;background:linear-gradient(135deg,#0f766e,#14b8a6);color:#ffffff"><div style="font-size:22px;font-weight:800;letter-spacing:-.4px">user<span style="color:#ccfbf1">tasks</span></div><div style="margin-top:8px;font-size:13px;opacity:.9">Work that moves forward</div></td></tr><tr><td style="padding:34px 30px"><div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#ccfbf1;color:#0f766e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px">Action required</div><h1 style="margin:18px 0 10px;font-size:26px;line-height:1.25;color:#17212b">{{user_task_title}}</h1><p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#52606d">{{user_task_description}}</p><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Open task</a></td></tr><tr><td style="padding:18px 30px;border-top:1px solid #e7eeee;color:#7a8a97;font-size:11px;line-height:1.5">This message was sent by a UserTasks workflow. If the button does not work, open UserTasks and visit your task queue.</td></tr></table></td></tr></table></body></html>',
     -- b. 20260722 backfill
     '<!doctype html><html><body style="margin:0;background:#f4f7f8;font-family:Inter,Arial,sans-serif;color:#17212b"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f8;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,118,110,.10)"><tr><td style="padding:24px 30px;background:#0f766e;color:#ffffff"><div style="font-size:22px;font-weight:800;letter-spacing:-.4px">user<span style="color:#ccfbf1">tasks</span></div><div style="margin-top:8px;font-size:13px;opacity:.9">Work that moves forward</div></td></tr><tr><td style="padding:34px 30px"><div style="display:inline-block;padding:6px 10px;border-radius:999px;background:#ccfbf1;color:#0f766e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px">Action required</div><h1 style="margin:18px 0 10px;font-size:26px;line-height:1.25;color:#17212b">{{user_task_title}}</h1><p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#52606d">{{user_task_description}}</p><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Open task</a></td></tr><tr><td style="padding:18px 30px;border-top:1px solid #e7eeee;color:#7a8a97;font-size:11px;line-height:1.5">This message was sent by a UserTasks workflow. If the button does not work, open UserTasks and visit your task queue.</td></tr></table></td></tr></table></body></html>',
     -- c. trigger default
     '<div style="background:#f4f7f8;padding:32px 16px;font-family:Inter,Arial,sans-serif"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden"><div style="padding:24px 30px;background:#0f766e;color:#fff;font-size:22px;font-weight:800">user<span style="color:#ccfbf1">tasks</span></div><div style="padding:34px 30px"><h1 style="color:#17212b">{{user_task_title}}</h1><p style="color:#52606d;line-height:1.7">{{user_task_description}}</p><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700">Open task</a></div></div></div>'
   )
   AND text_body IN (
     'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.',
     E'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.'
   );
