/**
 * Take Screenshot Native Tool
 *
 * Captures a screenshot of the current screen using platform-specific methods.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import type { NativeTool, NativeToolResult } from './types.js';

const execAsync = promisify(exec);

export class TakeScreenshotTool implements NativeTool {
  readonly name = 'take_screenshot';
  readonly description = 'Capture a screenshot of the current screen. Returns the screenshot as a base64-encoded data URL.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  async execute(_params: Record<string, unknown>): Promise<NativeToolResult> {
    const tempPath = join(tmpdir(), `screenshot-${uuid()}.png`);

    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS
        await execAsync(`screencapture -x "${tempPath}"`);
      } else if (platform === 'win32') {
        // Windows - use PowerShell
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          $screen = [System.Windows.Forms.Screen]::PrimaryScreen
          $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
          $bitmap.Save("${tempPath.replace(/\\/g, '\\\\')}")
          $graphics.Dispose()
          $bitmap.Dispose()
        `;
        await execAsync(`powershell -Command "${psScript.replace(/\n/g, '; ')}"`);
      } else {
        // Linux - try multiple screenshot tools
        try {
          await execAsync(`gnome-screenshot -f "${tempPath}"`);
        } catch {
          try {
            await execAsync(`scrot "${tempPath}"`);
          } catch {
            await execAsync(`import -window root "${tempPath}"`);
          }
        }
      }

      // Read screenshot as base64
      const imageBuffer = await readFile(tempPath);
      const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      // Clean up temp file
      await unlink(tempPath).catch(() => {});

      return {
        success: true,
        output: {
          dataUrl,
          format: 'png',
          capturedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      // Clean up temp file if it exists
      await unlink(tempPath).catch(() => {});

      return {
        success: false,
        error: `Screenshot capture failed: ${String(error)}`,
      };
    }
  }
}
