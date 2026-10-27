import { Platform, View } from 'react-native';

import { parseRichText, type Block } from '@/logic/richText';
import { Text } from '@/ui/components';
import { space } from '@/ui/tokens';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** The server's small report HTML (paragraphs, bullets, bold, italic, code) drawn as native text. Nothing in it can be tapped or loaded. */
export function RichText({ html }: { html: string | null | undefined }) {
  return <RichBlocks blocks={parseRichText(html)} />;
}

/** Paragraphs and bullets that are already parsed (the chats parse their own plain text into the same shape). */
export function RichBlocks({ blocks }: { blocks: readonly Block[] }) {
  if (blocks.length === 0) return null;
  return (
    <View style={{ gap: space.xs }}>
      {blocks.map((block, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
          {block.kind === 'bullet' ? (
            <Text variant="body" accessibilityElementsHidden importantForAccessibility="no">
              •
            </Text>
          ) : null}
          <Text variant="body" style={{ flex: 1 }}>
            {block.runs.map((run, j) => (
              <Text key={j} variant="body" style={{ fontWeight: run.bold ? '700' : undefined, fontStyle: run.italic ? 'italic' : undefined, fontFamily: run.code ? MONO : undefined }}>
                {run.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
}
