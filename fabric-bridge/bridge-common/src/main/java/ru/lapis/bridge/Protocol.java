package ru.lapis.bridge;

import java.util.Arrays;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.Identifier;

public final class Protocol {
  public static final int VERSION = 1;
  public static final Identifier AUTH_CHANNEL = Identifier.fromNamespaceAndPath("lapis", "auth");
  private static final int MAX_TEXT = 255;
  private static final int CHALLENGE_LENGTH = 32;

  private Protocol() { }

  public record Challenge(int protocolVersion, String serverId, String buildId, byte[] challenge) {
    public Challenge { challenge = Arrays.copyOf(challenge, challenge.length); }
  }

  public record Response(String ticket, String echoedChallenge, String nickname, String minecraftUuid, String buildId, int protocolVersion) { }

  public static void writeChallenge(FriendlyByteBuf buffer, Challenge value) {
    buffer.writeVarInt(value.protocolVersion());
    buffer.writeUtf(value.serverId(), MAX_TEXT);
    buffer.writeUtf(value.buildId(), MAX_TEXT);
    buffer.writeByteArray(value.challenge());
  }

  public static Challenge readChallenge(FriendlyByteBuf buffer) {
    int version = buffer.readVarInt();
    String serverId = buffer.readUtf(MAX_TEXT);
    String buildId = buffer.readUtf(MAX_TEXT);
    byte[] challenge = buffer.readByteArray(CHALLENGE_LENGTH);
    if (challenge.length != CHALLENGE_LENGTH) throw new IllegalArgumentException("Invalid challenge");
    return new Challenge(version, serverId, buildId, challenge);
  }

  public static void writeResponse(FriendlyByteBuf buffer, Response value) {
    buffer.writeUtf(value.ticket(), 128);
    buffer.writeUtf(value.echoedChallenge(), 128);
    buffer.writeUtf(value.nickname(), 16);
    buffer.writeUtf(value.minecraftUuid(), 32);
    buffer.writeUtf(value.buildId(), MAX_TEXT);
    buffer.writeVarInt(value.protocolVersion());
  }

  public static Response readResponse(FriendlyByteBuf buffer) {
    return new Response(buffer.readUtf(128), buffer.readUtf(128), buffer.readUtf(16), buffer.readUtf(32), buffer.readUtf(MAX_TEXT), buffer.readVarInt());
  }
}
