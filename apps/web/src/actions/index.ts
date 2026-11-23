import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { Resend } from "resend";
import { createItem } from "@directus/sdk";
import { RESEND_API_KEY, MAIL_FROM, TURNSTILE_SECRET_KEY } from "astro:env/server";
import { directus, readItems, readSingleton } from "@/lib/directus";

const resend = new Resend(RESEND_API_KEY);

// Clé secrète de test Cloudflare ("toujours valide") : on évite l'appel réseau en dev
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

async function verifyTurnstile(token: string, ip: string | undefined) {
  if (import.meta.env.DEV && TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET) return true;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success: boolean };
    return data.success;
  } catch (err) {
    console.error("[turnstile]", err);
    throw new ActionError({ code: "SERVICE_UNAVAILABLE", message: "Service momentanément indisponible, réessayez dans un instant." });
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const server = {
  bookingRequest: defineAction({
    accept: "form",
    input: z
      .object({
        name: z.string().trim().min(2, "Nom requis").max(120),
        email: z.email("Email invalide"),
        phone: z.string().trim().max(30).optional(),
        room: z.coerce.number().int().positive().optional(),
        arrival: z.iso.date("Date d'arrivée invalide"),
        departure: z.iso.date("Date de départ invalide"),
        guests: z.coerce.number().int().min(1).max(8),
        message: z.string().trim().max(3000).optional(),
        terms: z.literal("on", "Merci d'accepter les conditions de vente"),
        // Honeypot : doit rester vide (les robots le remplissent)
        website: z.string().max(0).optional(),
        "cf-turnstile-response": z.string().min(1, "Vérification anti-robot manquante"),
      })
      .refine((d) => d.departure > d.arrival, { message: "Le départ doit être après l'arrivée", path: ["departure"] }),

    handler: async (input, ctx) => {
      if (!(await verifyTurnstile(input["cf-turnstile-response"], ctx.clientAddress))) {
        throw new ActionError({ code: "FORBIDDEN", message: "Vérification anti-robot échouée, réessayez." });
      }

      const { website: _hp, "cf-turnstile-response": _ts, terms: _terms, ...data } = input;

      // 1. Enregistrement dans Directus (visible par la propriétaire dans le back-office)
      await directus.request(createItem("booking_requests", { ...data, status: "new" }));

      // 2. Emails
      const settings = await directus.request(readSingleton("settings")).catch(() => null);
      const roomName = data.room
        ? (await directus.request(readItems("rooms", { filter: { id: { _eq: data.room } }, fields: ["name"], limit: 1 })))[0]?.name
        : undefined;
      const to = settings?.notification_email ?? settings?.contact_email;
      const siteName = settings?.site_name ?? "Ohana Lodge";

      const recap = `
        <p><strong>${escape(data.name)}</strong> (${escape(data.email)}${data.phone ? `, ${escape(data.phone)}` : ""})</p>
        <p>Du <strong>${data.arrival}</strong> au <strong>${data.departure}</strong> — ${data.guests} pers.${roomName ? ` — ${escape(roomName)}` : ""}</p>
        ${data.message ? `<p>${escape(data.message).replace(/\n/g, "<br>")}</p>` : ""}`;

      const sends = [
        resend.emails.send({
          from: MAIL_FROM,
          to: data.email,
          subject: `${siteName} — nous avons bien reçu votre demande`,
          html: `<p>Bonjour ${escape(data.name)},</p><p>Merci pour votre demande. Nous revenons vers vous très vite pour la confirmer.</p>${recap}<p>${escape(siteName)}</p>`,
        }),
      ];
      if (to) {
        sends.push(
          resend.emails.send({
            from: MAIL_FROM,
            to,
            replyTo: data.email,
            subject: `Nouvelle demande de réservation — ${data.name}`,
            html: recap,
          }),
        );
      }
      // La demande est déjà enregistrée : un échec d'email est loggé mais ne bloque pas le visiteur
      for (const r of await Promise.allSettled(sends)) {
        if (r.status === "rejected") console.error("[resend]", r.reason);
        else if (r.value.error) console.error("[resend]", r.value.error);
      }

      return { ok: true, roomName };
    },
  }),
};
