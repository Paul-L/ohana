import { defineModule } from "@directus/extensions-sdk";
import ConnexionsPage from "./ConnexionsPage.vue";

export default defineModule({
  id: "connexions",
  name: "Connexions",
  icon: "hub",
  routes: [{ path: "", component: ConnexionsPage }],
});
