package ru.lapis.bridge.server;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.List;
import java.util.UUID;

import com.mojang.authlib.properties.Property;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class SkinRestorerIntegration {
  private static final Logger LOGGER = LoggerFactory.getLogger("lapis-bridge-skins");
  private static volatile boolean refreshConfigured;

  private SkinRestorerIntegration() {}

  static boolean apply(UUID playerUuid, String nickname, LapisSkin skin) {
    if (skin == null) return true;
    if (!FabricLoader.getInstance().isModLoaded("skinrestorer")) {
      LOGGER.warn("Could not apply Lapis skin for '{}': SkinRestorer is not installed.", nickname);
      return false;
    }

    try {
      Class<?> skinRestorerType = Class.forName("net.lionarius.skinrestorer.SkinRestorer");
      Class<?> skinValueType = Class.forName("net.lionarius.skinrestorer.skin.SkinValue");
      Class<?> skinVariantType = Class.forName("net.lionarius.skinrestorer.skin.SkinVariant");
      configureRefreshSkip(skinRestorerType);

      @SuppressWarnings({"rawtypes", "unchecked"})
      Object variant = Enum.valueOf(
          (Class<? extends Enum>) skinVariantType.asSubclass(Enum.class),
          "slim".equals(skin.model()) ? "SLIM" : "CLASSIC");
      Property texture = new Property("textures", skin.value(), skin.signature());
      Constructor<?> skinValueConstructor = skinValueType.getConstructor(
          String.class, String.class, skinVariantType, Property.class);
      Object skinValue = skinValueConstructor.newInstance(
          "lapis", skin.textureUrl(), variant, texture);

      Object storage = skinRestorerType.getMethod("getSkinStorage").invoke(null);
      if (storage == null) throw new IllegalStateException("SkinRestorer storage is not initialized");
      Method setSkin = storage.getClass().getMethod("setSkin", UUID.class, skinValueType);
      setSkin.invoke(storage, playerUuid, skinValue);
      LOGGER.info("Applied Lapis skin for '{}'.", nickname);
      return true;
    } catch (ReflectiveOperationException | RuntimeException error) {
      LOGGER.warn("Could not apply Lapis skin for '{}'.", nickname, error);
      return false;
    }
  }

  private static synchronized void configureRefreshSkip(Class<?> skinRestorerType)
      throws ReflectiveOperationException {
    if (refreshConfigured) return;
    Object config = skinRestorerType.getMethod("getConfig").invoke(null);
    Object join = config.getClass().getMethod("join").invoke(config);
    Object providers = join.getClass().getMethod("skipRefreshProviders").invoke(join);
    if (!(providers instanceof List<?> list))
      throw new IllegalStateException("Unexpected SkinRestorer refresh provider configuration");
    @SuppressWarnings("unchecked")
    List<Object> mutable = (List<Object>) list;
    if (!mutable.contains("lapis")) mutable.add("lapis");
    refreshConfigured = true;
  }
}
