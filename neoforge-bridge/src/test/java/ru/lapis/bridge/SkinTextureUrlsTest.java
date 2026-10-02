package ru.lapis.bridge;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SkinTextureUrlsTest {
    private static final String HASH = "a".repeat(64);
    private static final String NORMALIZED = "https://textures.minecraft.net/texture/" + HASH;

    @Test
    void acceptsHttpUrlFromSignedPayloadAfterApiNormalization() {
        assertTrue(SkinTextureUrls.sameTexture(
                NORMALIZED, "http://textures.minecraft.net/texture/" + HASH));
        assertTrue(SkinTextureUrls.sameTexture(NORMALIZED, NORMALIZED));
    }

    @Test
    void rejectsDifferentTextureOrOrigin() {
        assertFalse(SkinTextureUrls.sameTexture(
                NORMALIZED, "https://textures.minecraft.net/texture/" + "b".repeat(64)));
        assertFalse(SkinTextureUrls.sameTexture(
                NORMALIZED, "https://evil.example/texture/" + HASH));
        assertFalse(SkinTextureUrls.sameTexture(
                NORMALIZED, NORMALIZED + "?redirect=1"));
    }
}
