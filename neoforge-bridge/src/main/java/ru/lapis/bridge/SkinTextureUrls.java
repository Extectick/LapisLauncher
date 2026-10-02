package ru.lapis.bridge;

import java.net.URI;

final class SkinTextureUrls {
    private static final String CANONICAL_ORIGIN = "https://textures.minecraft.net";

    private SkinTextureUrls() {}

    static boolean sameTexture(String normalizedUrl, String signedUrl) {
        if (!normalizedUrl.matches("https://textures\\.minecraft\\.net/texture/[a-fA-F0-9]{64}"))
            return false;
        URI signed = URI.create(signedUrl);
        return ("http".equalsIgnoreCase(signed.getScheme())
                    || "https".equalsIgnoreCase(signed.getScheme()))
                && "textures.minecraft.net".equalsIgnoreCase(signed.getHost())
                && signed.getPort() == -1
                && signed.getRawQuery() == null
                && signed.getRawFragment() == null
                && signed.getPath() != null
                && signed.getPath().matches("/texture/[a-fA-F0-9]{64}")
                && normalizedUrl.substring(CANONICAL_ORIGIN.length())
                        .equalsIgnoreCase(signed.getPath());
    }
}
