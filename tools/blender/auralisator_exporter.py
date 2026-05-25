bl_info = {
    "name": "3D Auralisator GLB Exporter",
    "author": "3D Auralisator",
    "version": (0, 1, 0),
    "blender": (4, 0, 0),
    "location": "File > Export > 3D Auralisator (.glb)",
    "description": "Exports Blender/FBX scenes to a GLB package suitable for 3D Auralisator imports.",
    "category": "Import-Export",
}

import json
import os
import bpy
from bpy.props import BoolProperty, StringProperty
from bpy_extras.io_utils import ExportHelper


class AURALISATOR_OT_export_glb(bpy.types.Operator, ExportHelper):
    bl_idname = "auralisator.export_glb"
    bl_label = "Export 3D Auralisator GLB"
    bl_options = {"PRESET"}

    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})
    export_selected: BoolProperty(
        name="Selected Objects Only",
        default=False,
    )
    apply_modifiers: BoolProperty(
        name="Apply Modifiers",
        default=True,
    )
    export_metadata: BoolProperty(
        name="Write Metadata JSON",
        default=True,
    )

    def execute(self, context):
        filepath = self.filepath
        bpy.ops.export_scene.gltf(
            filepath=filepath,
            export_format="GLB",
            use_selection=self.export_selected,
            export_apply=self.apply_modifiers,
            export_yup=True,
            export_materials="EXPORT",
            export_animations=False,
            export_cameras=False,
            export_lights=False,
            export_extras=True,
        )
        if self.export_metadata:
            self.write_metadata(context, filepath)
        return {"FINISHED"}

    def write_metadata(self, context, filepath):
        objects = context.selected_objects if self.export_selected else context.scene.objects
        mesh_objects = [obj for obj in objects if obj.type == "MESH"]
        metadata = {
            "format": "3d-auralisator-blender-export",
            "source_blender": bpy.app.version_string,
            "glb": os.path.basename(filepath),
            "units": context.scene.unit_settings.system,
            "scale_length": context.scene.unit_settings.scale_length,
            "objects": [
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": list(obj.location),
                    "rotation_euler": list(obj.rotation_euler),
                    "scale": list(obj.scale),
                    "material_slots": [slot.material.name for slot in obj.material_slots if slot.material],
                }
                for obj in mesh_objects
            ],
        }
        meta_path = os.path.splitext(filepath)[0] + ".auralisator.json"
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)


def menu_func_export(self, context):
    self.layout.operator(AURALISATOR_OT_export_glb.bl_idname, text="3D Auralisator (.glb)")


def register():
    bpy.utils.register_class(AURALISATOR_OT_export_glb)
    bpy.types.TOPBAR_MT_file_export.append(menu_func_export)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu_func_export)
    bpy.utils.unregister_class(AURALISATOR_OT_export_glb)


if __name__ == "__main__":
    register()
