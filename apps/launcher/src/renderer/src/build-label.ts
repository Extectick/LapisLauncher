import type { ServerCatalogItem } from "@lapis/contracts";

type Build = Pick<ServerCatalogItem["build"], "loader" | "minecraftVersion">;

export function loaderDisplayName(loader: Build["loader"]): string {
  switch (loader) {
    case "fabric":
      return "Fabric";
    case "neoforge":
      return "NeoForge";
  }
}

export function formatBuildVersion(build: Build): string {
  return `${loaderDisplayName(build.loader)} ${build.minecraftVersion}`;
}
