# Claude Development Guide for Grok Zephyr

This document provides guidelines for AI-assisted development on the Grok Zephyr project.

## 🎯 Project Overview

Grok Zephyr is a WebGPU-based orbital simulation for visualizing 1M+ satellites in real-time. The project is well-architected with:
- Modular TypeScript codebase with strict type checking
- GPU-accelerated compute shaders for orbital mechanics
- A 6-pass rendering pipeline with bloom and post-processing
- Multiple camera modes and interactive controls

## 🛠️ Development Workflow

### Making Changes

1. **Always read files first** before proposing modifications
2. **Keep changes focused** - fix the reported issue without refactoring surrounding code
3. **Maintain the existing style** - follow the established patterns in each module
4. **Test locally** with `npm run dev` before committing
5. **Type-check** with `npm run type-check` to ensure correctness

### Code Quality Standards

- **TypeScript**: Use strict mode, prefer explicit types over `any`
- **No premature optimization**: Only optimize bottlenecks you've measured
- **Simple solutions**: Avoid over-engineering; prefer straightforward code
- **Comments**: Add comments only when logic isn't self-evident
- **No feature creep**: Don't add features beyond what's requested

### Common Tasks

#### Running the Development Server
```bash
npm run dev  # Starts Vite dev server at http://localhost:5173
```

#### Type Checking
```bash
npm run type-check  # Verify TypeScript correctness before committing
```

#### Production Build
```bash
npm run build  # Creates optimized dist/ for deployment
```

#### Performance Analysis
Look for the `PerformanceProfiler` class in `src/utils/` - it tracks FPS and GPU metrics.

## 📁 Key File Locations

- **Entry Point**: `src/main.ts`
- **Core GPU Management**: `src/core/WebGPUContext.ts`, `src/core/SatelliteGPUBuffer.ts`
- **Rendering Pipeline**: `src/render/RenderPipeline.ts`
- **Camera System**: `src/camera/CameraController.ts`
- **Shaders**: `src/shaders/*.wgsl` (compute and fragment shaders)
- **Configuration**: `src/types/constants.ts`
- **UI Management**: `src/ui/UIManager.ts`

## 🚀 Feature Development

### When Adding New Features

1. **Check existing modules** - reuse code that's already there
2. **Follow the module structure** - place code in appropriate directories (physics, render, ui, etc.)
3. **Add TypeScript interfaces** to `src/types/index.ts` if needed
4. **Update ARCHITECTURE.md** if the structure changes significantly
5. **Test with multiple view modes** - ensure features work in all camera modes

### Performance Considerations

- Satellite data is GPU-resident; minimize CPU-GPU transfers
- Compute shaders handle orbital propagation (fast)
- Rendering uses a 6-pass pipeline with LOD and culling
- The UI is optimized for real-time updates

## 🐛 Debugging Tips

- **GPU Issues**: Check browser console for WebGPU errors
- **Performance**: Use the built-in FPS counter in the UI
- **Type Errors**: Run `npm run type-check` before debugging runtime issues
- **Shader Problems**: WebGPU shader compiler errors appear in the browser console
- **Browser Support**: Test in Chrome/Edge first, Firefox Nightly for experimental features

## 📋 Git Workflow

- Develop on assigned branches (typically `claude/*`)
- Commit messages should be clear and descriptive
- Push to the assigned branch with `git push -u origin <branch>`
- Keep commits focused on specific changes

## 🎓 Resources

- **WGSL Shaders**: See `src/shaders/` for compute and rendering shader examples
- **WebGPU API**: https://www.w3.org/TR/webgpu/
- **Orbital Mechanics**: satellite.js documentation in node_modules
- **TypeScript**: Strict mode by default; check `tsconfig.json`

## 💡 Best Practices

### Do's
✅ Read the existing code before making changes
✅ Keep changes minimal and focused
✅ Run type-check and tests locally first
✅ Write clear commit messages
✅ Reference architecture documents when unsure
✅ Test in multiple browsers (Chrome/Edge preferred)

### Don'ts
❌ Don't refactor unrelated code
❌ Don't add "nice-to-have" features not in the spec
❌ Don't commit without type-checking
❌ Don't assume GPU availability (fallback gracefully)
❌ Don't modify tsconfig.json without discussion
❌ Don't ignore TypeScript errors or use `any` types

## 🔗 Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design and module structure
- [AGENTS.md](./AGENTS.md) - AI agent specifications
- [SWARM_PROMPT.md](./SWARM_PROMPT.md) - Multi-agent coordination
- [package.json](./package.json) - Dependencies and build scripts

## 📞 Questions?

If you're unsure about something:
1. Check the existing code for patterns
2. Review ARCHITECTURE.md for high-level guidance
3. Look at similar implementations in the codebase
4. Check browser console for error messages

---

**Happy coding!** This is an exciting project with lots of room for interesting improvements. 🚀
