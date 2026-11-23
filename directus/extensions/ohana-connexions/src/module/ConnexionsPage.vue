<template>
  <private-view title="Connexions">
    <template #title-outer:prepend>
      <v-button class="header-icon" rounded disabled icon secondary><v-icon name="hub" /></v-button>
    </template>

    <div class="page">
      <p class="intro">
        Reliez les comptes du lodge pour que le site affiche automatiquement les avis Google (chaque nuit) et les dernières
        photos Instagram (chaque lundi). Connectez-vous avec le compte qui gère la fiche Google ou le compte Instagram.
      </p>

      <v-notice v-if="flash" :type="flash.type" class="flash">{{ flash.text }}</v-notice>
      <v-progress-circular v-if="!status" indeterminate />

      <template v-else>
        <section class="card">
          <header>
            <v-icon name="reviews" />
            <div>
              <h2>Avis Google</h2>
              <p v-if="status.google.connected" class="state ok">Connecté{{ status.google.email ? ` avec ${status.google.email}` : "" }}</p>
              <p v-else class="state">Non connecté</p>
            </div>
          </header>

          <v-notice v-if="!status.google.configured" type="warning">
            Application Google non configurée sur le serveur (identifiants à renseigner par le développeur, voir README).
          </v-notice>

          <template v-else>
            <div v-if="status.google.connected && status.google.locations.length > 1" class="field">
              <p class="label">Fiche de l'établissement</p>
              <v-select
                :model-value="status.google.location"
                :items="status.google.locations.map((l) => ({ text: l.title, value: l.name }))"
                placeholder="Choisir la fiche"
                @update:model-value="selectLocation"
              />
            </div>
            <p v-else-if="status.google.locationTitle" class="detail">Fiche : {{ status.google.locationTitle }}</p>

            <last-sync :sync="status.google.lastSync" />

            <div class="actions">
              <v-button :loading="busy === 'google-start'" :secondary="status.google.connected" @click="connect('google')">
                {{ status.google.connected ? "Reconnecter" : "Connecter Google" }}
              </v-button>
              <template v-if="status.google.connected">
                <v-button secondary :loading="busy === 'google-sync'" :disabled="!status.google.location" @click="sync('google')">Synchroniser maintenant</v-button>
                <v-button secondary kind="danger" :loading="busy === 'google-disconnect'" @click="disconnect('google')">Déconnecter</v-button>
              </template>
            </div>
          </template>
        </section>

        <section class="card">
          <header>
            <v-icon name="photo_camera" />
            <div>
              <h2>Photos Instagram</h2>
              <p v-if="status.instagram.connected" class="state ok">Connecté{{ status.instagram.username ? ` à @${status.instagram.username}` : "" }}</p>
              <p v-else class="state">Non connecté</p>
            </div>
          </header>

          <p v-if="status.instagram.connected && status.instagram.source === 'behold'" class="detail">
            Photos lues via Behold (flux mis à jour chaque jour par Behold).
          </p>
          <p v-if="status.instagram.connected && status.instagram.source === 'api' && status.instagram.expiresAt" class="detail">
            Accès valable jusqu'au {{ date(status.instagram.expiresAt) }}, prolongé automatiquement à chaque synchro.
          </p>

          <div v-if="!status.instagram.connected || editingFeed" class="field">
            <p class="label">
              Adresse du flux Behold : créez un compte gratuit sur
              <a href="https://behold.so" target="_blank" rel="noopener">behold.so</a>, connectez le compte Instagram
              (professionnel) du lodge, créez un flux « JSON » puis copiez son adresse ici.
            </p>
            <div class="feed">
              <v-input v-model="feedUrl" placeholder="https://feeds.behold.so/…" />
              <v-button :loading="busy === 'instagram-feed'" :disabled="!feedUrl" @click="saveFeed">Enregistrer</v-button>
            </div>
          </div>

          <last-sync :sync="status.instagram.lastSync" />

          <div class="actions">
            <v-button v-if="status.instagram.configured" :loading="busy === 'instagram-start'" secondary @click="connect('instagram')">
              {{ status.instagram.source === "api" ? "Reconnecter" : "Connecter via Instagram" }}
            </v-button>
            <v-button v-if="status.instagram.source === 'behold' && !editingFeed" secondary @click="editFeed">Changer de flux</v-button>
            <template v-if="status.instagram.connected">
              <v-button secondary :loading="busy === 'instagram-sync'" @click="sync('instagram')">Synchroniser maintenant</v-button>
              <v-button secondary kind="danger" :loading="busy === 'instagram-disconnect'" @click="disconnect('instagram')">Déconnecter</v-button>
            </template>
          </div>
        </section>
      </template>
    </div>
  </private-view>
</template>

<script setup lang="ts">
import { ref, onMounted, defineComponent, h, type PropType } from "vue";
import { useApi } from "@directus/extensions-sdk";
import { useRoute, useRouter } from "vue-router";

type Provider = "google" | "instagram";
type Sync = { at: string; ok: boolean; message: string } | null;
interface Status {
  google: { configured: boolean; connected: boolean; email: string | null; location: string | null; locationTitle: string | null; locations: { name: string; title: string }[]; lastSync: Sync };
  instagram: { configured: boolean; connected: boolean; source: "behold" | "api" | null; feedUrl: string | null; username: string | null; expiresAt: string | null; lastSync: Sync };
}

const api = useApi();
const route = useRoute();
const router = useRouter();
const status = ref<Status | null>(null);
const busy = ref<string | null>(null);
const flash = ref<{ type: "success" | "danger"; text: string } | null>(null);
const feedUrl = ref("");
const editingFeed = ref(false);
const names: Record<Provider, string> = { google: "Google", instagram: "Instagram" };

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
const errorText = (err: any) => err?.response?.data?.error ?? err?.message ?? "Erreur inconnue";

const LastSync = defineComponent({
  props: { sync: { type: Object as PropType<Sync>, default: null } },
  setup: (props) => () =>
    props.sync
      ? h("p", { class: ["sync", props.sync.ok ? "ok" : "error"] }, [
          h("strong", `Dernière synchro le ${date(props.sync.at)} : `),
          props.sync.message,
        ])
      : null,
});

async function load() {
  status.value = (await api.get("/connexions/status")).data;
}

async function run(key: string, fn: () => Promise<unknown>, success?: string) {
  busy.value = key;
  flash.value = null;
  try {
    await fn();
    if (success) flash.value = { type: "success", text: success };
    await load();
  } catch (err) {
    flash.value = { type: "danger", text: errorText(err) };
  } finally {
    busy.value = null;
  }
}

const connect = (p: Provider) =>
  run(`${p}-start`, async () => {
    const { data } = await api.get(`/connexions/${p}/start`);
    window.location.href = data.url;
  });
const sync = (p: Provider) => run(`${p}-sync`, () => api.post(`/connexions/${p}/sync`));
const disconnect = (p: Provider) => {
  if (!window.confirm(`Déconnecter ${names[p]} ? Le site gardera les derniers éléments importés jusqu'à la prochaine connexion.`)) return;
  return run(`${p}-disconnect`, () => api.post(`/connexions/${p}/disconnect`), `${names[p]} déconnecté.`);
};
const editFeed = () => {
  feedUrl.value = status.value?.instagram.feedUrl ?? "";
  editingFeed.value = true;
};
const saveFeed = () =>
  run("instagram-feed", async () => {
    await api.post("/connexions/instagram/feed", { url: feedUrl.value });
    editingFeed.value = false;
  }, "Flux Instagram enregistré, photos importées.");
const selectLocation = (location: string) => run("google-location", () => api.post("/connexions/google/location", { location }), "Fiche enregistrée.");

onMounted(async () => {
  const { connected, error } = route.query;
  if (connected === "google" || connected === "instagram") flash.value = { type: "success", text: `${names[connected]} est connecté.` };
  else if (typeof error === "string") flash.value = { type: "danger", text: error };
  if (connected || error) router.replace({ query: {} });
  await load().catch((err) => (flash.value = { type: "danger", text: errorText(err) }));
});
</script>

<style scoped>
.page { padding: 0 var(--content-padding) var(--content-padding-bottom); max-width: 760px; display: flex; flex-direction: column; gap: 24px; }
.intro { color: var(--theme--foreground-subdued); line-height: 1.6; }
.card { border: var(--theme--border-width) solid var(--theme--border-color-subdued); border-radius: var(--theme--border-radius); padding: 24px; display: flex; flex-direction: column; gap: 16px; background: var(--theme--background); }
.card header { display: flex; gap: 14px; align-items: center; }
.card h2 { font-size: 18px; font-weight: 600; }
.state { color: var(--theme--foreground-subdued); }
.state.ok { color: var(--theme--success); }
.detail, .label { color: var(--theme--foreground-subdued); }
.label { margin-bottom: 8px; }
.sync { font-size: 14px; line-height: 1.5; }
.sync.ok { color: var(--theme--foreground-subdued); }
.sync.error { color: var(--theme--danger); }
.feed { display: flex; gap: 12px; align-items: center; }
.feed .v-input { flex: 1; }
.label a { color: var(--theme--primary); text-decoration: underline; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; }
.header-icon { --v-button-color-disabled: var(--theme--foreground); }
</style>
